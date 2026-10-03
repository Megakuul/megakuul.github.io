**Orbstrike** should be a simple 2D multiplayer game running on a Flutter Flame frontend while streaming updates live over a gRPC stream. 

## Purpose

The idea when I started developing this project was to create a basic multiplayer game and build a backend server from scratch. I've never done any research on how game servers scale. I just wanted to build it from scratch.

My goal was to make the server infrastructure horizontally scalable while still performing extremely well.

## Implementation

To implement this project, I've designed a server architecture where the actual game servers are "attached" to one or more game boards. This allows them to interact at high performance without the need to access a database. To keep data consistent, game servers "sync" the game board with the cache database in the background.

For routing the requests to the appropriate server (that is "attached" to the board that the request needs to access), there is a second entity called the "orchestrator". Orchestrator servers operate as proxy servers; they route the traffic to the game server that runs the requested game. The orchestrator also handles failover by moving games to other available servers when necessary. Clustering orchestrators is also no problem, as they use a fo-master election system that defines an orchestrator to handle the failover operations.  

Game servers perform a "log-in" over the database; this feature allows the orchestrators to "auto-discover" the game servers without specifying the addresses of the servers anywhere. This is crucial in a highly scalable environment like Kubernetes, that can just add game servers on demand. The system basically allows Kubernetes to treat the stateful game servers as stateless apps.

After the full implementation and successful tests on regular nodes, I started creating the Kubernetes system for Orbstrike. Unfortunately, I discovered a major issue while doing so. Surprisingly, it was not even my application, but rather the database... Scaling the Redis database on Kubernetes, the way I wanted it to, caused massive problems (sharding+failover). One of them is that Redis cannot connect to other nodes by dnsname (for performance reasons). In Kubernetes, you should never use the IP of pods, and this is kinda pushing you there.
I know that there are solutions to work around this (e.g. using a Redis Operator), but the ones I found were just very complex (and could lead to strange problems that I may never find the cause of).

I am aware that this may come across as inane. However, one evening I was so massively pissed off that I decided to develop a KV database that could solve the problems I had with Redis in Kubernetes. Since then, I put the project on hold and started creating some proof of concepts for "[HyperCache](https://github.com/Megakuul/HyperCache)".

## Lessons Learned

In this project, I've definitely strengthened my knowledge of the GO and Dart programming languages, which for me is a big plus. Besides that, I also learned some basic principles about game development and graphic rendering (for example, when creating the [image_scaler](https://github.com/Megakuul/image_scaler) to rescale my game characters).

Don't get me wrong here, but at this point I also think that my design idea was actually pretty smart and could work very well. I'm just waiting for the AWS EC2 bill, in production, to knock on my door and prove me wrong.

So about the fact that I've dropped Redis here, I cannot really say too much, as I don't actually know how HyperCache will evolve.
Maybe the following lines will reveal a long statement about why I'm dumb and what I was thinking back then. We'll see...
