Reward based calendar system to stop the doomscroll.

## Purpose

It was the end of the year 2025, and the preparations for the WorldSkills 2026 in Shanghai were starting to ramp up.
As part of the Swiss National Team, I was going to compete in the skill 53 **Cloud Computing**. The skill is highly competitive / contested, and I knew that I needed to grind through the next half year to not land at the bottom of the leaderboard.

Unfortunately, I often get distracted while doing large and rather less creative work. This is where I decided to create Zen.

Zen works like a normal calendar but requires you to plan your whole day step by step (breaks are also planned!).
After planning, you use your phone to start and stop events (requires you to be honest with yourself on this part).

Zen will award points to give you little dopamine hits if you work according to your plan.

Basically this system should train your discipline and stop you from doing things just because they look tempting right now (for example, what stops you from just lying in the bed and doomscrolling forever... in Zen you are allowed to do this but only for the time you planned yesterday evening).

## Implementation

This is an application most people would AI-slop, but not me! Instead, I built the system on top of AWS Lambda functions and DynamoDB (literally scales to the moon now, and as we all know, this is what counts).

It uses an API layer I wanted to use for a long time: ConnectRPC.

The backend consists of Lambda functions written in Go using a typesafe ConnectRPC server.
The frontend is written as a static SvelteKit application that also uses the typesafe ConnectRPC connector to communicate with the Lambda functions. 

To make the project a bit more complex and to play around with AWS SQS, I also implemented a queue system that emits score results to a queue, which is then processed to generate a static JSON leaderboard, which is uploaded to S3.

As the name implies, I also tried to create a very calm and beautiful UI... While this is highly subjective, I liked it soo much that I even transitioned the background and "glassy" theme to this blog as well. :-)

## Lessons Learned

As you might notice, for this project I used Pulumi! It was the first time I changed from Terraform and CloudFormation, and you know what? It was the best decision I ever made. Pulumi is not perfect in any regard, but it is fully typesafe and allows me to write out infrastructure wayy faster. Besides, because Pulumi runs just in a normal Go binary, I was also able to package initial chicken-egg steps (like deployment of the state bucket) into the same `monk` binary. This is pretty cool as it now allows a much simpler deployment.

Overall I had much fun implementing this project; the most depressing thing is that unfortunately I quickly fell into a hole of ignoring the app... so it turns out the hardest thing is not to implement it but to actually stay locked in to its usage.

After WorldSkills ends, I will now start using it again. Wish me luck; I'll not drop it again 🍀
