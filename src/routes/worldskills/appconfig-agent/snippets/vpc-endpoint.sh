VPC_ID=vpc-0123456789abcdef0
SUBNET_IDS=subnet-0123456789abcdef0,subnet-0123456789abcdef1
ENDPOINT_SG=sg-0123456789abcdef0
aws ec2 create-vpc-endpoint --vpc-id "$VPC_ID" --vpc-endpoint-type Interface --service-name "com.amazonaws.$AWS_REGION.appconfigdata" --subnet-ids "${SUBNET_IDS%%,*}" "${SUBNET_IDS##*,}" --security-group-ids "$ENDPOINT_SG" --private-dns-enabled
# IRSA also needs STS HTTPS; container image pulls need registry connectivity.
