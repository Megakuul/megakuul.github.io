<script>
    import Quirk from "../Quirk.svelte";
</script>

## Autoscaler

Official and perfect service description:

<img class="rounded-2xl opacity-70" alt="autoscaler_meme" src="/images/autoscaler_meme.png" />

## Tracking Policy

Sample to react to ELB status codes

```json
{
  "CustomizedMetricSpecification": {
    "Dimensions": [
      {
        "Name": "LoadBalancer",
        "Value": "app/KongProxy/aaaaaaaaaaaaaaaa"
      }
    ],
    "MetricName": "HTTPCode_Target_4XX_Count",
    "Namespace": "AWS/ApplicationELB",
    "Statistic": "Sum",
    "Period": 60
  }
}
```

The dimension information can be found in the Cloudwatch metric selector table or alternatively it is also displayed after creating an alarm (same for Namespace, MetricName and Statistic).

Default period is 60 seconds btw and you cannot go higher.

uses alarm under the hood (effecitvely just boilerplates the dynamic simple scaling policy)

Simple: locks down full scaler (cooldown)
Step: allows defining per step
Tracking: wraps step and simplifies it to autocreate in and outscaler

TargetGroups have a deregister time which is often 5 minutes (which is how long it takes to scale in at least)

## Watch Out 👀

- **Instance Type Requirements** allow you to define how many capacity unit an instance type consumes. Do not set this arbitrarily high; it will never scale xD

![autoscaler_weight](/images/autoscaler_weight.png)
