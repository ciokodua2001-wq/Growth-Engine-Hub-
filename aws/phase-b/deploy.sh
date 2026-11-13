#!/usr/bin/env bash
# Phase B provisioning orchestrator. Run as the awsops user, e.g.:
#   sudo -u awsops -H ./deploy.sh g6e.4xlarge
# Prereqs (one-time, owner): ltx-worker-key (key pair), ltx-worker-instance-role +
# ltx-worker-instance-profile (see aws/iam/ltx-worker-instance-role-policy.json).
set -euo pipefail
INSTANCE_TYPE="${1:-g6e.4xlarge}"
REGION="us-east-1"
PROFILE="growthforge-ltx"
VOL_GB=200
aws() { command aws --profile "$PROFILE" --region "$REGION" "$@"; }

echo "== quota (L-DB2E81BA) =="
aws service-quotas get-service-quota --service-code ec2 --quota-code L-DB2E81BA --query "Quota.Value" --output text

echo "== Ubuntu 24.04 AMI =="
AMI=$(aws ec2 describe-images --owners 099720109477 --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" "Name=state,Values=available" --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text)

echo "== default subnet + AZ =="
SUBNET=$(aws ec2 describe-subnets --filters "Name=default-for-az,Values=true" --query "Subnets[0].SubnetId" --output text)
AZ=$(aws ec2 describe-subnets --subnet-ids "$SUBNET" --query "Subnets[0].AvailabilityZone" --output text)

echo "== security group =="
SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=ltx-worker" --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name ltx-worker --description "LTX worker" --tag-specifications "ResourceType=security-group,Tags=[{Key=ltx,Value=worker}]" --query "GroupId" --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22 --cidr "$(curl -s ifconfig.me)/32"
fi

echo "== EBS data volume (gp3 ${VOL_GB}GB) =="
VOL_ID=$(aws ec2 create-volume --size "$VOL_GB" --volume-type gp3 --availability-zone "$AZ" --tag-specifications "ResourceType=volume,Tags=[{Key=ltx,Value=worker},{Key=Name,Value=ltx-models}]" --query "VolumeId" --output text)

echo "== launch $INSTANCE_TYPE (tag ltx=worker required) =="
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --key-name ltx-worker-key --security-group-ids "$SG_ID" --subnet-id "$SUBNET" \
  --iam-instance-profile Name=ltx-worker-instance-profile \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":60,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --user-data "file://bootstrap.sh" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=ltx,Value=worker},{Key=Name,Value=ltx-worker}]" \
  --query "Instances[0].InstanceId" --output text)

echo "== attach data volume =="
aws ec2 attach-volume --volume-id "$VOL_ID" --instance-id "$INSTANCE_ID" --device /dev/sdf

echo "== wait running =="
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
PUBIP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query "Reservations[0].Instances[0].PublicIpAddress" --output text)

echo "== idle-stop alarm (external enforcer layer 2) =="
aws cloudwatch put-metric-alarm --alarm-name ltx-worker-idle-stop \
  --metric-name CPUUtilization --namespace AWS/EC2 --statistic Average \
  --period 300 --evaluation-periods 3 --threshold 3 --comparison-operator LessThanThreshold \
  --dimensions Name=InstanceId,Value="$INSTANCE_ID" \
  --alarm-actions arn:aws:automate:us-east-1:ec2:stop

echo "DONE instance=$INSTANCE_ID ip=$PUBIP vol=$VOL_ID sg=$SG_ID type=$INSTANCE_TYPE"
