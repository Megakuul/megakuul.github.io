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
