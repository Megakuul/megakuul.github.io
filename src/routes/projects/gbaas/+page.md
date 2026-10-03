**Gitbackup-as-a-Service** is as the name suggests, a cloud-native solution to back up Github repositories.

## Purpose

This project should be a simple solution to automatically back up repositories from GitHub to another location.

I aimed to make this a very cost-effective but reliable solution.

## Implementation

Since git backups are really fast and don't require a constantly running machine, I decided to use a serverless Lambda function triggered by a time-based EventBridge rule.
The function will then fetch the public repositories of a specified GitHub user or organization, clone the repositories, compress them and move them over a memory buffer to the S3 bucket, where the backups are processed by S3 lifecycles.

Backups are also replicated to a second S3 bucket, where the lifecycle stores them much longer but in a "deep-archive" state, which makes the objects extremely slow to access.

Besides that, I also implemented a basic HTML page to see the current repository backups (which I later on also distributed with a CloudFront instance).


## Lessons Learned

In this project I have built up a basic knowledge of the AWS services used (S3, Lambda and CloudFormation).
I was also able to build up some basic knowledge over how the Git protocol works. 
