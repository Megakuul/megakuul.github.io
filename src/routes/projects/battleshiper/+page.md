Serverless automation platform that can scale faster than the GameStop stock (with a name parodied from **[shiper](https://shiper.app)**).

## Purpose

After I sadly overheard that the **[shiper](https://shiper.app)** platform does NOT support the GOAT and Messias of all js frameworks, I started to build this bad boy.


Battleshiper's purpose is to build a fully automated SvelteKit deployment platform that takes care of building, shipping, and running SvelteKit.

It's designed to run on top of serverless cloud functions and statically cached assets, allowing applications to scale until Jeff Bezos personally knocks on my door.

## Implementation

Battleshiper is fully integrated into the AWS serverless system. It exposes a RESTful HTTP API that runs entirely on top of serverless Go functions. The API uses SSO authentication with the unstandardized Github crap they like to call "OAuth2" or sometimes even "OpenID Connect" (that they even dare to...).

Those functions used to store data inside a DocumentDB database (AWS fork of MongoDB); unfortunately, after FULLY FUCKING IMPLEMENTING the whole system, I figured out how the crew of the Koru yacht is paid... $200 for a single-node DocumentDB cluster without traffic (wtf?). This led to a painful refactoring of the entire application, migrating over to DynamoDB (much cheaper for my use case).


The HTTP API itself is not responsible for performing infrastructure updates; this is managed by so-called pipeline functions, which initialize, build, deploy, and delete user projects. The HTTP API uses an AWS EventBus to inform the functions about the operations they need to perform. This design is necessary because updating the infrastructure and building projects is obviously not a task that can be accomplished in the time window of one HTTP request.

Pipeline components also use Go functions for most of their operations. The build process, however, is isolated in an AWS Batch job, allowing users to run the bitcoin miner of their choice, without interfering with the main system.

The dedicated project infrastructure is deployed in detached CloudFormation stacks, which are rolled out by the pipeline functions. To ensure fast deployments, everything that can be outsourced to a shared component is outsourced. The infrastructure of shared components is not updated when building projects, which makes the entire pipeline much faster.


To prevent abuse of the platform, Battleshiper implements limits for most operations. These limits are defined in so-called Subscriptions. 
Additionally, there is an extensive Admin API, that can be used to update resources like the this. To restrict access Battleshiper implements an RBAC role concept.


## Lessons Learned

Most of the time on this project was actually spent reading the AWS and Github documentation.
The incompleteness of those docs often led to surprises like hitting specific limits of AWS services.

This project learned me that I'm definitely the type who would rather self-implement such serverless systems. Even if AWS provides extreme benefits in terms of their serverless infrastructure (like scaling literally to the moon), it typically comes down to a single little feature that is needed but not supported.

To be clear: If an application is perfectly suited to run on the AWS serverless infrastructure, that can be an absolute game changer. However, it must be clear what the application requirements are and what they will be in the future. If this is not clear before building the application, you may eventually run into a real problem.

Finally, I can say that I, personally, was often not very motivated to work on this project, as I find it rather uninteresting to read dozens of documents or Github issues. Still, I learned a lot about the AWS ecosystem, especially the serverless components, and became aware of the challenges involved in building such a deployment platform.
