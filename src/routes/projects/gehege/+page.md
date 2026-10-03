Gehege is a Webapplication where you can list multiple cages with creatures in it. Every account can then spend his cash to different cages.

## Purpose

The goal was to create an example application that can be deployed with Docker.

## Implementation

For the project, I used **Dart** along with **Flutter** for the frontend. 

To implement the backend, I used **ExpressJS** on **Nodejs**. I've created a basic RESTful API that can be accessed from the frontend.

As database I once again used **MongoDB**, as I just feel comfortable with it.

The Webauthentication is handled with cookies, I basically save a token generated on the server to the cookie.

On the API I disabled **CORS** policies, so that the frontend can access the API.

## Lessons Learned

This was my first project where I used an authentication system from scratch. This went really well in my opinion, even if a more secure way to handle Webauthentication would be to use **JSON Webtokens**.

I also struggled a lot with the **CORS** policies that produced weird bugs. In the future, I need to check if the source, destination and potential middleware all allow requests related to the application. 

Another way to solve the **CORS** problem would be to just use a metaframework that has the API and the frontend running on the same server (e.g. domain).
