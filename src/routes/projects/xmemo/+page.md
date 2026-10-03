The XMemo platform is a full stack webapplication where you can play memory games against other players.

## Purpose

Memory is a dull game by itself, you just sit there with someone else and discover cards, hoping to get two similar ones. But where is the fun if the winner gets nothing?

The XMemo platform is expected to elevate the Memory game to a new level, as it should feature an Elo System that is akin to that found in Chess games. This system enables players to earn ranking points and advance in the leaderboard.

Furthermore, I wanted to create some more complex memory cards, which would be harder to remember than the usual ones.


## Implementation

In this project, I decided to use **Svelte** as the frontend framework. I have already used **Svelte** on the **LinoSteffen.ch** page, where I encountered some performance issues due to the fact that the pages were all **client side rendered**. To optimize this, I employed **SvelteKit** for this project to enable features like **SSR (Server-Side Rendering)**.

I chose **MongoDB** as the database because I needed a document database for this project. Moreover, the database is easily extensible on a horizontal scale environment.
To handle real-time data from the database, I used the change streams integrated in **MongoDB**.

Since I am familiar with these technologies, I chose **Node.js** and **Express** for the backend. For real-time data on the gameboard, I also brought in **Socket.io** for **Websocket** connections. 
I used **JSON-Webtokens** (**JWT**) for Webauthentication. This is achieved by using the **passport library** with the native **Express** tools.
I also used the **Mongoose ORM** to abstract the database model, which makes it possible to interact with the database with full type safety.


The entire project is hosted on a small **HPE server** in my basement. For this project I set up a full **Kuberenetes cluster** over multiple nodes. The loadbalancing of the nodes is handled by the **Metallb** loadbalancer, which is distributed throughout the cluster. 
As an ingress controller, I used **Traefik**, as it is one of the few that are well suited for **Kubernetes** and has full support for **Websockets**.

Multiple replication nodes are used to host the database on a **MongoDB-Cluster**. For this project, I did not use the sharding function of **MongoDB**, as it would just unnecessary increase complexity.

## Lessons Learned

First, I didn't really intend to use **SvelteKit**, I just used it to get a better performance for my **Svelte** application.
Something I could've done better is to use **SvelteKit** to build the **API** (instead of a separate **Node.js** application). That could've simplified the whole project.

During the deployment I experienced many problems with the **Websockets**, foremost, not all **Ingress-Controllers** support **Websocket**  connections, **Traefik** had some problems handling the connections as well. In order to resolve this issue, I used the **Long-Polling** option on the **Websocket**, for the **Ingress-Controller**. By that, a **Websocket** connection looks like a single request for the **Ingress-Controller**. 

Another issue is that my current DNS provider (**Cloudflare**) does not support many concurrent **Websocket** connections in the free plan (if using their proxy). This sometimes caused weird problems when using the application.

For simple apps that don't require a lot of performance, it's enough to send **RESTful requests** every second instead of using **Websockets**. When still employing **Websockets**, I must keep an eye on all the network applications that are involved in the project and may not be capable of handling these connections.

I would also use **Tailwind CSS** for the UI in the future, as it was disturbing to use raw **CSS** across the entire project.
