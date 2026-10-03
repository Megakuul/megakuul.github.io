The one and only civilization leaderboard.

## Purpose

To satisfy and further push my massive arrogance, what could be better than seeing myself on top of a leaderboard?


After playing waaaayy too much Sid Meiers Civilisation 6, I thought it would be a cool idea to create a civilization leaderboard that can calculate a ranking based on played games.


## Implementation

Leaderboard is a very simple but extremely powerful application. Because it relies on serverless aws components, it is not only very cheap in low traffic scenarios,
but also highly scalable. With some minor updates to the used components, this system can even be scaled globally.


The core application is based around a restful api written in Go and integrated into the aws api gateway. Running on lambda functions, the api uses the on-demand dynamodb database in combination with the cognito service for user authentication.


To ensure no invalid games are inserted, every participant of a game must confirm the result. The confirmation link for this, is delivered using the simple email service, another serverless component from aws.

The leaderboard ranking is calculated in a custom algorithm that ensures a fair reward based on the opponent's skill level, while ensuring that points never leave the leaderboard system. It's a simple but fairly sophisticated algorithm that also works with teams and adds an “underdog bonus” to the game.  


Finally, there is a simple Svelte frontend that is statically served from s3 and cached with cloudfront. Data for the frontend is consumed via the mentioned rest api.



## Lessons Learned

Creating the leaderboard was a pleasure, even though I curse aws cognito including their documentation, it is generally very pleasant to work with the serverless aws services.


For simplicity’ sake and due to the fact that cognito is officially the worst authentication system I have ever seen, I used the implicit OpenID Connect authentication flow (which is rather insecure).
In future projects, this won't happen, as I will definitely ensure to never ever touch cognito again.
