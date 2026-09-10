<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

## Table of Contents

## What EC2 already sends

| Monitoring              | Agent needed? | What you get                                                                                           |
| ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| EC2 basic monitoring    | No            | CPU, network, storage I/O and status checks. Most metrics every 5 minutes; status checks every minute. |
| EC2 detailed monitoring | No            | EC2 metrics every minute. It does not add guest memory or filesystem usage.                            |
| CloudWatch Agent        | Yes           | Guest memory, filesystem usage, application/system log files and optional extra collectors.            |

Basic monitoring is enabled by default. The CloudWatch Agent is a separate installation and configuration step; a custom AMI or existing automation may already have done it. SSM Agent is a different agent. [EC2 monitoring](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/manage-detailed-monitoring.html), [CloudWatch Agent installation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/install-CloudWatch-Agent-on-EC2-Instance.html).

Use the agent when you need memory, filesystem capacity or guest logs. Those are useful operational signals for EC2 and ASGs, particularly before instances are replaced. Keep collection to the signals you use: agent metrics and log ingestion are billable. For CPU-based ASG scaling, AWS recommends detailed EC2 monitoring; that setting works independently of the agent. [System-level monitoring](https://docs.aws.amazon.com/prescriptive-guidance/latest/implementing-logging-monitoring-cloudwatch/system-level-cloud-watch-configuration.html), [ASG monitoring](https://docs.aws.amazon.com/autoscaling/ec2/userguide/enable-as-instance-metrics.html).

## Log group, role and instance profile

[Logging Bootstrap](/worldskills/powertools/#logging-setup) creates `/aws/vendedlogs/powertools/ec2`, with tags, 30-day retention and deletion protection. It no longer creates an EC2 role or instance profile. An instance profile is the container that attaches an IAM role to EC2; it does not install software. The setup below grants the agent access to both metrics and logs.

### Operator environment

Run these commands on your workstation with Bash, AWS CLI v2 and jq. Set `ROLE_NAME` to the instance's existing role when adding the agent to an application server.

```bash
export ROLE_NAME=powertools-cwagent TAG_KEY=Project TAG_VALUE=powertools
export REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region)}}"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export PARTITION=$(aws sts get-caller-identity --query Arn --output text | cut -d: -f2)
```

### Standalone log group

Skip this if Logging Bootstrap already created the group.

```bash
aws logs create-log-group --log-group-name /aws/vendedlogs/powertools/ec2 --deletion-protection-enabled --tags "$(jq -cn --arg k "$TAG_KEY" --arg v "$TAG_VALUE" '{($k):$v}')" && aws logs put-retention-policy --log-group-name /aws/vendedlogs/powertools/ec2 --retention-in-days 30
```

### New role and profile

Skip this for an instance that already has a suitable EC2 role/profile. EC2 uses one instance profile at a time: attach the agent policy to the existing role to keep its application permissions. The role and profile below are tagged at creation. [EC2 role attachment](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/attach-iam-role.html).

```bash
aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' --tags "Key=$TAG_KEY,Value=$TAG_VALUE"
aws iam create-instance-profile --instance-profile-name "$ROLE_NAME" --tags "Key=$TAG_KEY,Value=$TAG_VALUE"
aws iam add-role-to-instance-profile --instance-profile-name "$ROLE_NAME" --role-name "$ROLE_NAME"
```

### Scoped agent policy

This matches the configuration below: one log group, `CWAgent` metrics in the current region, and tag discovery for the ASG dimension. `PutMetricData` and `DescribeTags` require `Resource: "*"`; their region and metric namespace are constrained. The agent cannot create log groups or change retention. No static AWS credentials are needed on the instance.

```bash
jq -n --arg region "$REGION" --arg log "arn:$PARTITION:logs:$REGION:$ACCOUNT_ID:log-group:/aws/vendedlogs/powertools/ec2" '{
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
      Resource: ($log + ":log-stream:*"),
      Condition: {StringEquals: {"aws:RequestedRegion": $region}}
    },
    {
      Effect: "Allow",
      Action: "logs:DescribeLogStreams",
      Resource: ($log + ":*"),
      Condition: {StringEquals: {"aws:RequestedRegion": $region}}
    },
    {
      Effect: "Allow",
      Action: "cloudwatch:PutMetricData",
      Resource: "*",
      Condition: {StringEquals: {"cloudwatch:namespace": "CWAgent", "aws:RequestedRegion": $region}}
    },
    {
      Effect: "Allow",
      Action: "ec2:DescribeTags",
      Resource: "*",
      Condition: {StringEquals: {"aws:RequestedRegion": $region}}
    }
  ]
}' > cwagent-policy.json
POLICY_ARN=$(aws iam create-policy --policy-name "$ROLE_NAME-cwagent" --policy-document file://cwagent-policy.json --tags "Key=$TAG_KEY,Value=$TAG_VALUE" --query Policy.Arn --output text) && aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY_ARN"
```

AWS also provides `CloudWatchAgentServerPolicy`. It covers additional collectors, broader log access, X-Ray and selected SSM parameters; the policy above deliberately covers this article's smaller configuration. Remove `ec2:DescribeTags` if you do not use the ASG dimension. [AWS managed policy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/CloudWatchAgentServerPolicy.html).

For an existing EC2 instance with **no profile attached**, attach the new profile:

```bash
export INSTANCE_ID=i-0123456789abcdef0
aws ec2 associate-iam-instance-profile --instance-id "$INSTANCE_ID" --iam-instance-profile Name="$ROLE_NAME"
```

The operator needs the corresponding IAM/EC2 provisioning permissions, including `iam:PassRole` for the instance role. Allow a newly created role/profile to propagate before launching instances.

## Minimal agent configuration

Create `cwagent.json` on your workstation. This collects memory and root-filesystem usage every minute, plus cloud-init and application log files. It avoids duplicating the native EC2 CPU/network metrics. Region and credentials come from EC2; the log group must already exist.

```bash
cat > cwagent.json <<'JSON'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root",
    "usage_data": false
  },
  "metrics": {
    "namespace": "CWAgent",
    "append_dimensions": {"InstanceId": "${aws:InstanceId}"},
    "metrics_collected": {
      "mem": {"measurement": ["mem_used_percent"]},
      "disk": {
        "resources": ["/"],
        "measurement": ["used_percent"],
        "drop_device": true
      }
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/cloud-init-output.log",
            "log_group_name": "/aws/vendedlogs/powertools/ec2",
            "log_stream_name": "{instance_id}/cloud-init"
          },
          {
            "file_path": "/var/log/app/*.log",
            "log_group_name": "/aws/vendedlogs/powertools/ec2",
            "log_stream_name": "{instance_id}/app"
          }
        ]
      }
    }
  }
}
JSON
```

Change the file paths to your application's logs. [AL2023 uses journald](https://docs.aws.amazon.com/linux/al2023/ug/journald.html); do not assume `/var/log/messages` exists. This example reads files, not the entire journal. Root is used to read root-owned boot logs; to run as `cwagent`, grant that user access to the configured files and their parent directories. Retention is owned by the log-group setup, so `retention_in_days` is intentionally omitted here. [Agent configuration fields](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html).

## Install and start on EC2

Copy the configuration to the instance through SSH, your image pipeline or your existing management tooling. For SSH:

```bash
export INSTANCE_ADDRESS=ec2-hostname-or-ip
scp cwagent.json "ec2-user@$INSTANCE_ADDRESS:/tmp/cwagent.json"
```

On **Amazon Linux 2023**, run:

```bash
sudo dnf install -y amazon-cloudwatch-agent
sudo install -m 0644 /tmp/cwagent.json /opt/aws/amazon-cloudwatch-agent/etc/cwagent.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/cwagent.json
sudo systemctl enable amazon-cloudwatch-agent
```

`fetch-config -s` validates, translates and starts the configuration; `enable` starts the service again after reboot. The JSON file can live elsewhere if the `file:` argument points there. Installing the package alone is not the complete setup. `amazon-linux-extras` is an AL2 tool, not an AL2023 installation step; this minimal configuration does not need collectd. [Package installation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/download-CloudWatch-Agent-on-EC2-Instance-commandline-first.html).

## Auto Scaling groups

Every replacement instance needs the agent, its configuration and an instance profile with the agent policy. Put the installation in your launch template's user data, or bake the package/configuration into your AMI. Keep the application's existing instance role and attach the scoped policy above to it. [Installation approaches](https://docs.aws.amazon.com/prescriptive-guidance/latest/implementing-logging-monitoring-cloudwatch/cloud-watch-installation-for-amazon-ec2-and-on-premises.html).

### ASG dimensions

On your workstation, derive the ASG configuration from the same file. Original per-instance metrics remain available, and the agent also emits a rollup with just `AutoScalingGroupName` for group-wide graphs/alarms. `{instance_id}` keeps log streams separate as instances are replaced. [Metric aggregation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-common-scenarios.html).

```bash
jq '.metrics.append_dimensions.AutoScalingGroupName = "${aws:AutoScalingGroupName}" | .metrics.aggregation_dimensions = [["AutoScalingGroupName"]]' cwagent.json > cwagent-asg.json
```

### User-data block

Generate a Bash boot script from that configuration. The base64 payload preserves the agent's `${aws:...}` placeholders through shell expansion and launch-template encoding. It contains configuration, not credentials.

```bash
CONFIG_BASE64=$(base64 < cwagent-asg.json | tr -d '\n')
cat > cwagent-user-data.sh <<EOF
#!/bin/bash
set -euo pipefail
dnf install -y amazon-cloudwatch-agent
printf '%s' '$CONFIG_BASE64' | base64 --decode > /opt/aws/amazon-cloudwatch-agent/etc/cwagent.json
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/cwagent.json
systemctl enable amazon-cloudwatch-agent
EOF
```

### Apply to a launch template

Use the launch template/version currently selected by your ASG. This example is for an ASG using a normal launch template; a mixed-instances policy has its own launch-template specification.

```bash
export ASG_NAME=my-asg LT_ID=lt-0123456789abcdef0 SOURCE_VERSION=1
aws ec2 describe-launch-template-versions --launch-template-id "$LT_ID" --versions "$SOURCE_VERSION" --query 'LaunchTemplateVersions[0].LaunchTemplateData' --output json > launch-template-current.json
jq -r '.UserData // empty' launch-template-current.json | base64 --decode > user-data.sh
```

Merge the generated agent block into `user-data.sh`, keeping your application bootstrap. For Bash, insert it before any `exit`; for cloud-init/MIME, integrate the commands into that format. If the template has **no existing user data**, use:

```bash
cp cwagent-user-data.sh user-data.sh
```

Create a version from the existing one, preserving its AMI, networking, tags and instance profile. Detailed EC2 monitoring is enabled for one-minute native metrics. The existing profile's role must have the agent policy attached.

```bash
USER_DATA=$(base64 < user-data.sh | tr -d '\n')
NEW_VERSION=$(aws ec2 create-launch-template-version --launch-template-id "$LT_ID" --source-version "$SOURCE_VERSION" --version-description 'CloudWatch agent' --launch-template-data "$(jq -cn --arg data "$USER_DATA" '{UserData:$data,Monitoring:{Enabled:true}}')" --query LaunchTemplateVersion.VersionNumber --output text) && aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$ASG_NAME" --launch-template "LaunchTemplateId=$LT_ID,Version=$NEW_VERSION"
```

This affects **future launches**. Existing instances keep their current configuration. To deploy to them without replacement, install/configure the agent using your existing SSM/management tooling. [Launch-template updates](https://docs.aws.amazon.com/cli/latest/reference/autoscaling/update-auto-scaling-group.html).

### Roll out by replacing existing instances

An instance refresh replaces instances. Use your application's health checks and sufficient warmup; this example keeps 100% healthy capacity and allows surge capacity. Ensure the group can launch replacements before starting it. [Instance refresh](https://docs.aws.amazon.com/autoscaling/ec2/userguide/start-instance-refresh.html).

```bash
aws autoscaling start-instance-refresh --auto-scaling-group-name "$ASG_NAME" --preferences '{"MinHealthyPercentage":100,"MaxHealthyPercentage":110,"InstanceWarmup":180,"SkipMatching":true}'
aws autoscaling describe-instance-refreshes --auto-scaling-group-name "$ASG_NAME" --query 'InstanceRefreshes[0].[Status,PercentageComplete,StatusReason]' --output table
```

When using this boot-script approach, create a new launch-template version for configuration changes. `SkipMatching` does not detect changed content fetched from an unchanged external URL.

## Verify and operate

On the instance:

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
sudo systemctl is-enabled amazon-cloudwatch-agent
sudo journalctl -u amazon-cloudwatch-agent -n 100 --no-pager
sudo tail -n 100 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log
sudo cat /opt/aws/amazon-cloudwatch-agent/logs/configuration-validation.log
```

From your workstation:

```bash
aws logs tail /aws/vendedlogs/powertools/ec2 --since 10m --follow
aws cloudwatch list-metrics --namespace CWAgent --metric-name mem_used_percent
aws cloudwatch get-metric-statistics --namespace CWAgent --metric-name mem_used_percent --dimensions "Name=AutoScalingGroupName,Value=$ASG_NAME" --start-time "$(jq -nr 'now-900 | todateiso8601')" --end-time "$(jq -nr 'now | todateiso8601')" --period 60 --statistics Average Maximum --output table
```

The last command uses the **ASG** configuration and its one-dimension rollup. A metric query must match the published dimension set. Allow a few collection intervals for data; new metric names can take longer to appear in `list-metrics`.

After editing the instance's JSON, apply it again:

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/cwagent.json
```

Stop/start the existing configuration:

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a stop
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a start
```

### Network and missing data

- Allow outbound HTTPS to regional CloudWatch metrics (`monitoring`) and Logs (`logs`) endpoints. ASG tag discovery also needs the EC2 API. Use NAT/internet access or suitable VPC endpoints; endpoint security groups must accept HTTPS from the instances. No inbound application port is needed for the agent to publish.
- Installation still needs access to the package repository. For isolated subnets, bake the package into the AMI or provide an internal package source. The agent also needs access to EC2 instance metadata for role credentials and dimensions.
- Check that the instance profile is attached, the role's region/namespace match the configuration, and the log group exists in that region. Check readable file paths, JSON validation and the agent log before broadening IAM permissions.
- This example runs as a systemd service on the host. Container/EKS deployments and additional collectors need their own configuration and permissions.

[CloudWatch connectivity](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/installing-cloudwatch-agent-ssm.html).

## Optional configuration in Parameter Store

For a central configuration, create a tagged **String** parameter containing the same JSON:

```bash
aws ssm put-parameter --name /powertools/cwagent --type String --value file://cwagent-asg.json --tags "Key=$TAG_KEY,Value=$TAG_VALUE"
```

Add read access for exactly that parameter to the agent policy, then make the new policy version the default:

```bash
jq --arg arn "arn:$PARTITION:ssm:$REGION:$ACCOUNT_ID:parameter/powertools/cwagent" '.Statement += [{Effect:"Allow",Action:"ssm:GetParameter",Resource:$arn}]' cwagent-policy.json > cwagent-policy-ssm.json
aws iam create-policy-version --policy-arn "$POLICY_ARN" --policy-document file://cwagent-policy-ssm.json --set-as-default
```

On the instance, replace the `file:` fetch with:

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c ssm:/powertools/cwagent
```

The agent reads Parameter Store directly; using `ssm:` does not itself require SSM Agent. It needs connectivity to the SSM API. Changing the parameter does not automatically reload running agents: fetch it again through your fleet-management process, or roll out a new launch-template version. Prefer versioned parameter names for reproducible rollouts. [Parameter Store configuration](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/installing-cloudwatch-agent-ssm.html).

## Advanced configuration reference

The following is a menu of optional collectors, **not the baseline to install unchanged**. It uses example paths, interfaces, a different namespace and cross-account credentials. Choose the sections you need and adapt their IAM permissions: logs to additional groups, `sts:AssumeRole` plus target-role trust for cross-account writes, and X-Ray permissions for traces. Collectd, Prometheus and application listeners require their own files/services; the scoped policy above does not cover all of them.

```json
{
  "agent": {
    "metrics_collection_interval": 60,
    "region": "eu-central-1",
    "run_as_user": "cwagent",
    "logfile": "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log",
    "debug": false,
    "omit_hostname": false,
    "credentials": {
      "role_arn": "arn:aws:iam::111111111111:role/CloudWatchAgentCrossAccount"
    }
  },
  "metrics": {
    "namespace": "WorldSkills/EC2",
    "force_flush_interval": 30,
    "append_dimensions": {
      "InstanceId": "${aws:InstanceId}",
      "InstanceType": "${aws:InstanceType}",
      "ImageId": "${aws:ImageId}",
      "AutoScalingGroupName": "${aws:AutoScalingGroupName}"
    },
    "aggregation_dimensions": [["AutoScalingGroupName"], ["InstanceId", "InstanceType"], []],
    "metrics_collected": {
      "cpu": {
        "resources": ["*"],
        "totalcpu": true,
        "measurement": [
          { "name": "cpu_usage_idle", "rename": "CPU_IDLE", "unit": "Percent" },
          "cpu_usage_user",
          "cpu_usage_system",
          "cpu_usage_iowait",
          "cpu_usage_steal"
        ],
        "metrics_collection_interval": 10,
        "append_dimensions": { "Tier": "frontend" }
      },
      "mem": {
        "measurement": ["mem_used_percent", "mem_available_percent", "mem_cached", "mem_total"],
        "metrics_collection_interval": 30
      },
      "swap": {
        "measurement": ["swap_used_percent", "swap_free"]
      },
      "disk": {
        "resources": ["/", "/var", "/data"],
        "measurement": ["used_percent", "free", "total", "inodes_free", "inodes_used"],
        "ignore_file_system_types": ["sysfs", "devtmpfs", "tmpfs", "overlay", "squashfs"],
        "drop_device": true,
        "metrics_collection_interval": 300
      },
      "diskio": {
        "resources": ["nvme0n1", "nvme1n1"],
        "measurement": [
          "io_time",
          "iops_in_progress",
          "read_bytes",
          "write_bytes",
          "reads",
          "writes"
        ]
      },
      "net": {
        "resources": ["ens5"],
        "measurement": [
          "bytes_sent",
          "bytes_recv",
          "packets_sent",
          "packets_recv",
          "err_in",
          "drop_in"
        ]
      },
      "netstat": {
        "measurement": ["tcp_established", "tcp_time_wait", "tcp_syn_sent", "udp_socket"]
      },
      "processes": {
        "measurement": ["running", "sleeping", "blocked", "zombies", "dead", "total"]
      },
      "procstat": [
        {
          "pattern": "nginx: worker process",
          "measurement": ["cpu_usage", "memory_rss", "num_fds", "num_threads", "read_bytes"],
          "metrics_collection_interval": 30
        },
        {
          "exe": "node",
          "measurement": ["cpu_usage", "memory_rss", "memory_swap", "pid_count"]
        },
        {
          "pid_file": "/var/run/mystery-daemon.pid",
          "measurement": [
            "cpu_time_system",
            "cpu_time_user",
            "memory_data",
            "involuntary_context_switches"
          ]
        }
      ],
      "ethtool": {
        "interface_include": ["ens5"],
        "metrics_include": [
          "bw_in_allowance_exceeded",
          "bw_out_allowance_exceeded",
          "pps_allowance_exceeded",
          "conntrack_allowance_exceeded",
          "linklocal_allowance_exceeded"
        ]
      },
      "statsd": {
        "service_address": ":8125",
        "metrics_collection_interval": 10,
        "metrics_aggregation_interval": 60,
        "allowed_pending_messages": 10000
      },
      "collectd": {
        "service_address": "udp://127.0.0.1:25826",
        "name_prefix": "collectd_",
        "collectd_security_level": "encrypt",
        "collectd_auth_file": "/etc/collectd/auth_file",
        "metrics_aggregation_interval": 60
      }
    }
  },
  "logs": {
    "force_flush_interval": 15,
    "log_stream_name": "fallback-{instance_id}",
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/messages",
            "log_group_name": "/worldskills/ec2/messages",
            "log_stream_name": "{instance_id}",
            "log_group_class": "STANDARD",
            "retention_in_days": 30,
            "timestamp_format": "%b %d %H:%M:%S",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/nginx/access.log",
            "log_group_name": "/worldskills/ec2/nginx/access",
            "log_stream_name": "{hostname}-access",
            "log_group_class": "INFREQUENT_ACCESS",
            "retention_in_days": 7,
            "filters": [
              { "type": "exclude", "expression": "GET /health" },
              { "type": "include", "expression": " (4|5)\\d{2} " }
            ]
          },
          {
            "file_path": "/var/log/app/**.log",
            "log_group_name": "/worldskills/app",
            "log_stream_name": "{ip_address}-{local_hostname}",
            "timestamp_format": "%Y-%m-%dT%H:%M:%S.%f%z",
            "multi_line_start_pattern": "{timestamp_format}",
            "encoding": "utf-8",
            "auto_removal": true,
            "publish_multi_logs": false,
            "retention_in_days": 1
          },
          {
            "file_path": "/var/log/java/enterprise.log",
            "log_group_name": "/worldskills/java",
            "log_stream_name": "{instance_id}-stacktraces",
            "multi_line_start_pattern": "^\\[\\d{4}-\\d{2}-\\d{2}",
            "retention_in_days": 90
          }
        ]
      }
    },
    "metrics_collected": {
      "emf": {},
      "prometheus": {
        "prometheus_config_path": "/opt/aws/amazon-cloudwatch-agent/etc/prometheus.yaml",
        "log_group_name": "/worldskills/prometheus",
        "emf_processor": {
          "metric_declaration_dedup": true,
          "metric_namespace": "WorldSkills/Prometheus",
          "metric_declaration": [
            {
              "source_labels": ["job"],
              "label_matcher": "^node-exporter$",
              "dimensions": [["InstanceId"], ["InstanceId", "instance"]],
              "metric_selectors": ["^node_filesystem_avail_bytes$", "^node_load1$"]
            }
          ]
        }
      }
    }
  },
  "traces": {
    "traces_collected": {
      "xray": {
        "bind_address": "127.0.0.1:2000",
        "tcp_proxy": { "bind_address": "127.0.0.1:2000" }
      },
      "otlp": {
        "grpc_endpoint": "127.0.0.1:4317",
        "http_endpoint": "127.0.0.1:4318"
      }
    },
    "concurrency": 8,
    "buffer_size_mb": 3
  }
}
```

<Note type="caution">
Agent configuration is strict JSON: no comments or trailing commas. Inspect <b>/opt/aws/amazon-cloudwatch-agent/logs/configuration-validation.log</b> when validation fails.
</Note>

<Quirk score={3.5}>
Editing the JSON does not apply it. Run <b>amazon-cloudwatch-agent-ctl -a fetch-config -s -m ec2 -c file:...</b> to translate and reload the configuration.
</Quirk>
