import os
import datetime
import boto3

# Independent time-based hard-stop enforcer (external, survives the instance).
# Invoked by an EventBridge schedule (rate 5 min). Stops any running ltx=worker
# instance whose LaunchTime is older than CAP_MIN.
CAP_MIN = int(os.environ.get("CAP_MIN", "120"))
REGION = os.environ.get("REGION", "us-east-1")

ec2 = boto3.client("ec2", region_name=REGION)

def handler(event, context):
    now = datetime.datetime.now(datetime.timezone.utc)
    resp = ec2.describe_instances(Filters=[
        {"Name": "tag:ltx", "Values": ["worker"]},
        {"Name": "instance-state-name", "Values": ["running"]},
    ])
    ids = []
    for res in resp.get("Reservations", []):
        for i in res.get("Instances", []):
            age_min = (now - i["LaunchTime"]).total_seconds() / 60.0
            if age_min > CAP_MIN:
                ids.append(i["InstanceId"])
    if ids:
        ec2.stop_instances(InstanceIds=ids)
        print("stopping over-cap instances:", ids)
    else:
        print("no over-cap workers")
    return {"stopped": ids}
