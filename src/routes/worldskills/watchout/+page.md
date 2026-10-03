<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

## Johnny English 🕵️

On Amazon AL2023 install the CloudWatch agent with this:

```bash
sudo yum install amazon-cloudwatch-agent
# if you get some collectd typeshii errors also install collectd
sudo amazon-linux-extras install collectd
```

(if you are using a real operating system like NixOS I assume you understand that you shouldn't use CloudWatch at all)

Here a big beautiful configuration example for the config that must be at `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json` (otherwise the agent fails):

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
        "measurement": ["io_time", "iops_in_progress", "read_bytes", "write_bytes", "reads", "writes"]
      },
      "net": {
        "resources": ["ens5"],
        "measurement": ["bytes_sent", "bytes_recv", "packets_sent", "packets_recv", "err_in", "drop_in"]
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
          "measurement": ["cpu_time_system", "cpu_time_user", "memory_data", "involuntary_context_switches"]
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
(btw you can just omit the namespace to use the default one).

<Note type="caution">
This file is <b>strict JSON</b>: no comments, no trailing commas. The agent doesn't tell you what it hates either, it just refuses to start — check <b>/opt/aws/amazon-cloudwatch-agent/logs/configuration-validation.log</b>.
</Note>

<br>

<Quirk score={3.5}>
The agent doesn't read <b>amazon-cloudwatch-agent.json</b> directly. On start it translates it into <b>etc/amazon-cloudwatch-agent.toml</b> and runs that. So if you edit the JSON without doing <b>amazon-cloudwatch-agent-ctl -a fetch-config -s -m ec2 -c file:...</b>, the agent happily keeps running the old config and you debug nothing for 20 minutes.
</Quirk>

## References

- [Install the Agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/install-CloudWatch-Agent-on-EC2-Instance.html) basically what I just said but with `--verbose` flag. 

