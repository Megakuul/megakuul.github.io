<script>
    import Quirk from "../Quirk.svelte";
</script>

## Install the botocore juice store

```bash
sudo dnf install amazon-efs-utils pip -y
sudo pip install boto3
```

## Mount HELL


## Policy Dogwater

The EFS is special therefore they are allowed to break the absolut default behavior of resource policies by using a default empty policy that grants anonymous root access.

Therefore as soon as you add a filesystem policy you must either grant access to "AWS": "*" principal or use efs mount helper with `-o iam`.

## IAM Dogwater

The EFS mount helper is a useless piece of garbage, it does not follow AWS IAM authentication (so it does for example not read credentials from env variables).
In emergency situations please always use `aws configure` to setup credentials in `~/.aws/credentials`:

```toml
[default]
aws_access_key_id = 1234
aws_secret_access_key = 1234
aws_session_token = 12345
```

and `~/.aws/config`:

```bash
[default]
region = us-east-1
```

## Cross-VPC mounting

(use `mounttargetip`, peering does not resolve dns)
however this is rarely required as the efs mount usually auto resolves to ip (not via dns but via AWS API if you have access to `ec2:DescribeAvailabilityZones` and )
```bash
sudo mount -t efs -o tls,iam,mounttargetip=10.100.142.16,accesspoint=fsap-08d92a9266dbc02ca fs-07d8ff99d04e46595:/ /mnt/exports
```


(please notice that if you use the "prevent anonymous access" policy, nfs will hang and it will also hang if not specifying "iam")
```bash
sudo mount -t efs -o tls,iam,mounttargetip=10.100.142.16,accesspoint=fsap-08d92a9266dbc02ca fs-07d8ff99d04e46595:/ /mnt/exports
```

## Nobrainer RW policy

```json 
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EFSClientAccess",
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite",
        "elasticfilesystem:ClientRootAccess",
        "elasticfilesystem:DescribeMountTargets",
        "elasticfilesystem:DescribeFileSystems",
        "elasticfilesystem:DescribeAccessPoints"
      ],
      "Resource": "*"
    },
    {
      "Sid": "this is optionaal",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeAvailabilityZones"
      ],
      "Resource": "*"
    }
  ]
}
```

(ec2:DescribeAvailabilityZone can be omitted by specifing the az via `-o az=eu-central-1a`)

## Watch Out 👀

- The AWS cli (e.g. `aws s3 cp`) execute more than just a simple GetObject api call; this can often lead to obscure errors (e.g. `aws s3 cp ...` reports `An error occurred (403) when calling the HeadObject operation: Forbidden`). To debug such errors you can use `aws s3api <operation> ...` calls which yield far better results in the majority of situations.

## Quirks
