<script>
    import Quirk from "../Quirk.svelte";
</script>

## Watch Out 👀

- If you encounter `Failed to connect to your instance` with EC2 instance connect, ensure that a security group on the instance allows access from the EIC PrivateLink. Notice that for private connections the ec2-instance-connect prefix list does not work (kinda obviously as it is routed via PrivateLink).

- I know this sounds dead-stupid but I missed it once so listen closely! Remember that IGW is only a static router, an instance (like fck-nat) inside a public subnet without public IP can obviously NOT access the internet and will therefore also completely fail to perform any AWS API calls (if there is no PrivateLink).

## Quirks

- Console does not accept security group if the VPCs got entered manually. _"Please select a security group that has EC2 scope."_
  ![vpc_sg_permission_issue](/images/vpc_sg_permission_issue.png)

<Quirk score={9.6}>
Add <b>"ec2:DescribeVpcs"</b> and <b>"ec2:DescribeSubnets"</b> access to the principal and select the VPC/Subnet from the dropdown or create the instance via cli.
</Quirk>

- `ec2:DescribeImages,DescribeVpcs,...` and many more cannot be resource scoped

<Quirk score={6.7}>
Accept it, use <b>"Resource": "*"</b> and don't take this as an example for a professional API design. 
</Quirk>

- The EC2 instance console does NOT display security groups of secondary ENI interfaces attached after instance launch.
  ![ec2_eni_sg_missing](/images/ec2_eni_sg_missing.png)

<Quirk score={10.5}>
Use the ENI console section to configure security groups.
</Quirk>
