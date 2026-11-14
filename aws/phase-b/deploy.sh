#!/usr/bin/env bash
# Phase B provisioning orchestrator. Run as the awsops user:
#   sudo -u awsops -H ./deploy.sh g6e.4xlarge
# Access is via SSM Session Manager (no public SSH, no key pair, no inbound rules).
# Prereqs (owner one-time):
#   - ltx-worker-instance-role + ltx-worker-instance-profile (role: self-stop+S3+logs
#     policy PLUS managed AmazonSSMManagedInstanceCore)
#   - ltx-stop-enforcer Lambda + EventBridge schedule rate(5 min) - external time-based hard stop
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

echo "== security group (deny-all inbound; SSM needs no inbound) =="
SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=ltx-worker" --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name ltx-worker --description "LTX worker (SSM, no inbound)" --tag-specifications "ResourceType=security-group,Tags=[{Key=ltx,Value=worker}]" --query "GroupId" --output text)
fi

echo "== EBS data volume (encrypted gp3 ${VOL_GB}GB) =="
VOL_ID=$(aws ec2 create-volume --size "$VOL_GB" --volume-type gp3 --availability-zone "$AZ" --encrypted --tag-specifications "ResourceType=volume,Tags=[{Key=ltx,Value=worker},{Key=Name,Value=ltx-models}]" --query "VolumeId" --output text)

echo "== launch $INSTANCE_TYPE (tag ltx=worker required) =="
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --security-group-ids "$SG_ID" --subnet-id "$SUBNET" \
  --iam-instance-profile Name=ltx-worker-instance-profile \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":60,"VolumeType":"gp3","Encrypted":true,"DeleteOnTermination":true}}]' \
  --user-data "file://bootstrap.sh" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=ltx,Value=worker},{Key=Name,Value=ltx-worker}]" \
  --query "Instances[0].InstanceId" --output text)

echo "== attach data volume =="
aws ec2 attach-volume --volume-id "$VOL_ID" --instance-id "$INSTANCE_ID" --device /dev/sdf

echo "== wait running =="
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

echo "DONE instance=$INSTANCE_ID vol=$VOL_ID sg=$SG_ID type=$INSTANCE_TYPE"
echo "Connect: aws ssm start-session --target $INSTANCE_ID --profile $PROFILE --region $REGION"
echo "NOTE: external time-based hard stop = owner-created ltx-stop-enforcer Lambda (EventBridge 5 min)."
