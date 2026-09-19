# ECS account defaults

The Setup → ECS Account Defaults powertool contains three direct AWS CLI commands. Supply the Region and an enabled GuardDuty detector ID. Run with appropriate ECS/GuardDuty permissions; organization-managed GuardDuty may require the delegated administrator. Commands are independent, so check each result. No discovery, validation script or jq dependency is included.

- `containerInsights=enhanced`: detailed observability for new clusters, with CloudWatch charges. Existing clusters and explicit principal/cluster overrides are not changed. Use the ECS cluster powertool for retained, customer-key-encrypted log groups; this account switch does not configure log encryption or retention.
- `awsvpcTrunking=enabled`: higher task density on new supported Linux EC2 hosts. ECS uses a trunk ENI and task branch ENIs, not unlimited secondary addresses on an ordinary ENI. Tasks still consume subnet addresses. Requires the ECS service-linked role, supported agent/AMI, resource-based IPv4 DNS disabled and non-shared subnets. The extra trunk interface uses the VPC default security group. AWS also documents public-IP loss on stop/start. This has no benefit for Fargate, Windows or existing hosts; validate launch templates and subnet capacity before launching replacements.
- GuardDuty Runtime Monitoring plus automatic Fargate agents: configured through GuardDuty because ECS `guardDutyActivate` is read-only. The command specifies Fargate agent management only; legacy EKS Runtime Monitoring requires migration first. Automatic Fargate management covers eligible clusters except exclusions such as `GuardDutyManaged=false`. Linux platform 1.4.0+, execution-role agent-pull permissions and ECR connectivity are prerequisites. Agent sidecars consume task resources and monitoring incurs charges. Existing tasks need a planned redeployment; the tool does not restart workloads. Verify actual GuardDuty runtime coverage, not just feature status.

EC2-hosted ECS requires host-agent configuration separately. Automatically enabling `EC2_AGENT_MANAGEMENT` here would also affect eligible **non-ECS EC2 instances** in the Region, so the tool leaves it unchanged. Review supported hosts, Systems Manager management and inclusion/exclusion tags before enabling it.

## Settings deliberately left alone

- Long ARN formats and tagging authorization are already mandatory; obsolete toggles are not emitted.
- FIPS, IPv6, task-retirement delay and EC2 event windows depend on compliance, network and maintenance requirements.
- Log-driver mode is a workload decision: non-blocking favors availability but can lose logs when buffers fill; blocking can stall the application. Set mode and buffer size explicitly in task definitions where required.
- Encryption, Action Logs, Exec logging, IAM permissions and retention remain cluster/task/resource configuration, not ECS account settings.

Sources: [ECS account settings](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-account-settings.html), [ENI trunking considerations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-instance-eni.html), [Runtime Monitoring prerequisites](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-guard-duty-configure-automatic-guard-duty.html), [GuardDuty detector configuration](https://docs.aws.amazon.com/cli/latest/reference/guardduty/update-detector.html).
