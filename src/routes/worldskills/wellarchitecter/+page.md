<script>
    import Quirk from "../Quirk.svelte";
</script>

## Table of Contents

## Facts

> Tag everything

~ Sun Tzu (The Art of War par. 1.)

---

> Use role jumps over direct resource policy access

~ Darth Vader (Well Architected SEC02)

---

> Apply least privileges to IAM and SGs

~ The creator of the matrix himself (Well Architected SEC03)

---

> Use layered networks; preferably with NAT GW (please we need money)

~ Beff Jezos (Well Architected SEC05)

---

> Enable VPC Network Address Usage (NAU) metrics before running out of network capacity

CloudFormation does not expose this setting. Enable it after creating the VPC:

```bash
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-network-address-usage-metrics
```

[AWS: VPC metrics and NAU monitoring](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cloudwatch.html)

---

> Avoid lambda $LATEST version for production

~ A concerned citizen (Well Architected OPS06)

---

> Shut up and enable GuardDuty

~ The one you send to kill the Boogeyman (Well Architected SEC04)
