# Powertools scope review · 2026-09-22

Reviewed the generated base templates and service-only alternatives, setup commands, and resource definitions. Only the EC2 tool was changed. A comparison of generated resource definitions confirmed that every other tool remained unchanged.

## EC2 correction

The old EC2 preset created a complete VPC, three subnets, internet/NAT gateways, an EIP, routes, S3/DynamoDB endpoints and VPC flow logging. It also installed nginx and a demo website.

It now launches in an existing VPC. Both shell commands select an available subnet with free IPv4 addresses, sorted by Availability Zone and then subnet ID. They stop on lookup errors or an empty result. CloudFormation also checks that the selected subnet belongs to the supplied VPC.

Inputs beyond the existing name/tags/architecture are `VPC_ID`, `SSH_CIDR` (the IPv4 network allowed on TCP 22), and a locally generated SSH key (no existing key pair needed). The instance uses the subnet's existing public-IP setting and routing. The snippet uses OpenSSH `ssh-keygen` to create `powertools-ec2-<NAME>.key` and its `.pub` file in the current directory, without overwriting existing files. CloudFormation imports only the public key and attaches it to the instance. After stack completion and instance status checks, the snippet prints the SSH command, preferring the public IP and falling back to the private IP. Your client still needs a route to that address and must be allowed by `SSH_CIDR`. Windows key generation requires PowerShell 7.3+ and OpenSSH.

The instance retains encrypted gp3 storage, IMDSv2, monitoring, its launch template, SSM instance role/profile, encrypted cloud-init logs and a status alarm. No application is installed. Package installation/log delivery need the existing network's outbound connectivity. Removing the old cloud-init signal also removes the stack's application-readiness wait.

The deployment command creates a new stack. Existing stacks are not migrated or updated by this change.

## Other bundled workloads and storage — reported, not changed

| Tool | Additional behavior | Scope concern |
| --- | --- | --- |
| CloudFront | Creates a new application S3 bucket and connects it as the origin, plus a separate access-log bucket, OAC, WAF and alarms. | Chooses and provisions the application origin rather than accepting an existing origin. |
| Transfer Family SFTP | Creates a new S3 data bucket and user role alongside the server. | Chooses and provisions the storage backend rather than accepting an existing bucket. |
| Data Firehose | Creates a new S3 destination bucket and configures delivery into it. | Chooses and provisions destination storage rather than accepting an existing destination. |
| EventBridge Scheduler | Creates an **enabled hourly schedule** that invokes `TARGET_ARN` with `{}`, plus its execution role, DLQ and alarm. | Starts a recurring workload with a fixed frequency and payload immediately. |
| Alarms | Deploys a Lambda collector, invokes it every five minutes, creates an SNS topic and aggregate alarms. The collector discovers queues, Lambda functions, SNS subscriptions, EventBridge targets and Scheduler targets across the account/Region. | Deploys a regional monitoring application instead of just alarms for selected resources; discovery is not limited to the project tag. |

## Shared settings and broad provisioning — reported, not changed

| Tool | Behavior to be aware of |
| --- | --- |
| REST API | When `DEPLOYMENT_ID` is supplied, creates `AWS::ApiGateway::Account`, setting the regional API Gateway CloudWatch role. That setting is shared with other REST APIs, not confined to the new API. The optional authorizer is disabled by default; no backend application is created. |
| Logging | Pre-creates log groups for many services, multiple delivery roles and delivery destinations in one stack, whether or not those services are needed. It does not itself launch those services. |
| Glue Security Defaults | Changes Data Catalog metadata/connection-password encryption for the account/Region, as well as creating a role, key and reusable security configuration. The account scope is documented in the current card. |
| IoT Device Defender Audit | Configures account-level IoT auditing and logging, a daily audit and SNS notifications. This is broader than a per-device configuration. |
| AWS Config | Starts a regional recorder covering all supported resource types, including global resource types; creates its delivery bucket and role. |

I treated logging, encryption keys, scoped IAM roles, DLQs and service-specific alarms as supporting infrastructure, not automatically as scope violations. The VPC presets intentionally create networks. RDS, EFS, ALB and NLB already take existing VPC inputs; the standalone Launch Template creates no VPC, instance or ASG. ECS creates the cluster and its operational dependencies but no application service or tasks.

## Implementation references

- [Infrastructure definitions](../src/lib/server/powertools/infrastructure.ts)
- [Service definitions](../src/lib/server/powertools/definitions/services.yaml)
- [Setup definitions](../src/lib/server/powertools/definitions/setup.yaml)
- [Shell command generation](../src/lib/server/powertools/commands.ts)
