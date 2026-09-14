## Table of Contents

## IAM

- IAM Access Analyzer enabled

## VPC & Networking

- VPC Encryption Controls (monitor)
- Flow logs enabled on every VPC
- Security groups have no `0.0.0.0/0` on anything but 80/443
- Gateway VPC endpoints for S3 and DynamoDB

## EC2 & Auto Scaling

- EBS volumes encrypted at rest (account settings)
- ASG spans multiple AZs
- ASG health check type set to `ELB`, not just `EC2`

## Elastic Load Balancing

- Deletion protection enabled
- Access logs enabled
- Cross-zone load balancing enabled
- WAF Web ACL attached (ALB)

## S3

- Block Public Access enabled
- Versioning enabled
- Object Lock enabled at bucket creation (only doable then, safe to flip even with no retention set yet)

## CloudFront

- WAF Web ACL attached
- Logging enabled

## Route 53

- Alias records used instead of CNAME for AWS targets

## RDS & Aurora (all automatically)

- Multi-AZ enabled
- Backup retention > 0 (PITR possible)
- Encryption at rest enabled
- Deletion protection enabled
- Not publicly accessible

## DynamoDB

- Deletion protection
- Point-in-time recovery enabled

## ElastiCache

- Multi-AZ with automatic failover enabled
- Encryption in transit and at rest enabled
- AUTH token configured
- Automatic backups enabled

## Lambda

- Dead-letter queue / on-failure destination configured
- Secrets pulled from Secrets Manager/SSM, not plaintext env vars
- Alias/version used in production, not `$LATEST`
- X-Ray tracing enabled

## API Gateway

- Throttling limits set
- Access/execution logging enabled
- WAF Web ACL attached

## SQS & SNS

- Dead-letter queue configured
- Encryption at rest enabled
- SNS subscriptions have a DLQ for failed deliveries

## EventBridge & Step Functions

- Dead-letter queue configured on rules/targets
- Step Functions logging to CloudWatch enabled

## EKS

- Control plane logging enabled for all log types (off by default)
- API endpoint access restricted
- IRSA / Pod Identity used for pod AWS access, not the node role

## KMS, Secrets Manager & SSM Parameter Store

- KMS key rotation enabled (off by default)
- Sensitive SSM parameters are `SecureString`, not plain `String`
- Secrets Manager rotation enabled

## GuardDuty & Security Hub

- GuardDuty enabled (purely detective, off by default)
- Security Hub enabled to aggregate the findings

## CloudTrail & Config

- Multi-region trail enabled (single-region by default)
- Log file validation enabled
- AWS Config recorder enabled (tool)

## CloudWatch & Logging

- Log group deletion protection
- Log group retention set (default is "Never expire")

## Backup

- AWS Backup plan covers every stateful resource in scope
- Vault lock enabled (doesn't touch existing backups, just stops anyone deleting them early)

## Cognito

- MFA enabled/enforced on the user pool
- Advanced security features on (compromised credentials, adaptive auth)
- Deletion protection enabled

## IoT Core & Device Defender

- Device Defender Audit enabled with every supported check and a daily scheduled audit
- Audit role attached; SNS notifications enabled and the subscription confirmed
- IoT logging enabled with retention on `AWSIotLogsV2`
- Unique certificate per device; expired/revoked certificates disabled
- IoT policies restricted to the device client ID, topics and shadows
- Rule actions use scoped execution roles; Lambda invocation restricted to the rule ARN
- Rule error action configured so failed deliveries are visible
- Device Defender Detect only used in accounts that already have access (closed to new customers)

## Transfer Family

- SFTP enabled; plaintext FTP disabled
- VPC endpoint security group restricted to the client network
- Current compatible security policy selected; clients verify the server host key
- Separate user role and logical home directory; S3 permissions restricted to that user's prefix
- SSH private keys stored outside user data and images
- Structured CloudWatch logging enabled with retention
- S3 storage encrypted, versioned and blocked from public access
- Connector credentials in Secrets Manager; trusted remote host keys configured
- Workflow custom steps send success/failure callbacks; exception handling configured

## Data Firehose & Kinesis

- Stream encryption enabled
- Delivery role restricted to the destination bucket/prefix and log stream
- S3 destination encrypted and blocked from public access
- Firehose delivery logging and failed-record prefix configured
- Delivery freshness/failure alarms have notification actions
- Producers handle partial batch failures; consumers tolerate duplicate records
- Kinesis retention covers the recovery window

## Glue & Athena

- Glue Data Catalog metadata and connection passwords encrypted
- Security configuration attached to every Glue job/crawler (S3 output, logs and job bookmarks)
- KMS key policy permits the job/crawler role and regional CloudWatch Logs service as needed
- Job/crawler roles restricted to their S3 prefixes, catalog resources and keys
- Job timeout, maximum retries and concurrent runs bounded
- Athena workgroup enforces result encryption and a scan limit
- Query results stored privately with retention/lifecycle rules

## EventBridge Scheduler

- Execution role trust restricted to the account and schedule group
- Execution permissions restricted to the exact target
- Retry count and maximum event age bounded
- Encrypted DLQ configured; queue-depth alarm connected to notifications
- One-time schedules delete themselves after completion
- Lambda async execution failures handled separately from Scheduler delivery failures

## DataSync

- Location roles restricted to the source and destination bucket/prefix
- Source and destination encryption keys accessible to the transfer roles
- Verification enabled (`ONLY_FILES_TRANSFERRED` for Enhanced mode)
- Destination deletions disabled unless the task explicitly requires mirroring
- Task logs/reports enabled and failed executions monitored
- AWS-to-AWS transfer used without an agent where supported

## SES

- Sending identity verified; DKIM enabled and SPF/DMARC records configured
- Sending role restricted to the allowed identity/from address
- Bounce and complaint events routed to a monitored destination
- Account suppression list enabled for bounces and complaints
- TLS required on the configuration set where the receiving mail server supports it
- Sandbox recipient restrictions checked before testing delivery
