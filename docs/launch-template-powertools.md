# Launch template powertools

The Launch Template card creates a reusable AL2023 launch template, an SSM instance role/profile, and a protected, KMS-encrypted CloudWatch log group. It creates no VPC, security group, instance, ASG, load balancer or demo application. Its existing `service-asg` anchor and `asg.yaml` download name are retained for links. Deploy it as a new stack; do not apply it over an old bundled ASG stack without reviewing the removal of its running resources.

Set `ARCHITECTURE=x86_64` (default, `t3.micro`) or `ARCHITECTURE=arm64` (`t4g.micro`). The AMI and instance type change together. The template includes encrypted gp3 root storage, IMDSv2, detailed monitoring, instance/volume/ENI tags, no public IPv4 address, SSM, and cloud-init output collection. Outputs include the template ID and version, profile ARN and log group.

Select subnets when creating the ASG. A launch template can omit security groups, but instances still receive the selected VPC's default security group. The ASG has no independent security-group override. To use a dedicated workload group, create a launch template version with `NetworkInterfaces[0].Groups` set to groups from the target VPC, then select that version in the ASG. Do not also set top-level `SecurityGroupIds` when using interface-level groups. Changing the default VPC group affects other instances using it.

Instances need outbound access to AL2023 package repositories, SSM/SSM Messages and CloudWatch Logs. Add application startup and application log collection for your workload. ASG health checks, scaling, multiple AZs, target groups and alarms belong to the ASG you create. Pin the output template version; new versions do not automatically replace existing instances.

## Instance → AMI + Launch Template

The Setup card accepts `INSTANCE_ID`, a unique `NAME`, and project tags. Run it in Bash with AWS CLI and jq, using the source instance's account and Region.

1. Read the instance configuration with `get-launch-template-data` and verify an EBS-backed running/stopped source.
2. Create an AMI and tag its EBS snapshots. By default AWS reboots the source to flush disk writes. `NO_REBOOT=true` avoids that interruption but only captures data already written to disk; quiesce application/database writes if consistency matters.
3. Wait for the AMI to become available and create a launch template using that new image.

This copies disk state, not RAM, process state, network connections, instance identity, or instance-store contents. Your programs must start on boot, for example through enabled systemd services. External databases and mounted network filesystems are not copied. Disk contents include any stored credentials and application data; prepare the source accordingly.

The recipe preserves the source instance type (and therefore its architecture compatibility), IAM profile, EBS optimization, CPU options and credit specification. It enables detailed monitoring and requires IMDSv2. It uses the new AMI's disk mappings and inherited encryption; it does not re-encrypt unencrypted source snapshots. It deliberately builds a fresh single primary interface without an SG, subnet, fixed IP or ENI ID, disables public IPv4 assignment, and omits the source SSH key and placement. Specialized networking, dedicated hosts, reservations and licensing need separate configuration. The source role must remain available, and the launcher needs `iam:PassRole` and applicable KMS permissions.

Original user data is omitted by default: baked software is already on disk, and old user data may overwrite configuration or send signals to an unrelated stack. Set `COPY_USER_DATA=true` only after reviewing that script. Boot-time behavior also depends on the OS/cloud-init state captured in the image; test one clone before scaling out. Requiring IMDSv2 can affect legacy applications that only use IMDSv1.

The command prints `AMI_ID` before waiting. If the waiter times out, wait again for that ID rather than creating another AMI. The AMI and snapshots remain if template creation fails; they are not managed by CloudFormation or automatically removed. No new instance is launched by this card. Use the returned launch template ID/version in an ASG or the EC2 launch workflow, and configure the destination networking as described above.

## References

- [AWS launch template networking and default security groups](https://docs.aws.amazon.com/autoscaling/ec2/userguide/create-launch-template.html)
- [Retrieve launch template data from an instance](https://docs.aws.amazon.com/cli/latest/reference/ec2/get-launch-template-data.html)
- [Create an AMI and reboot behavior](https://docs.aws.amazon.com/cli/latest/reference/ec2/create-image.html)
