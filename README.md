# lambda-simple-scrapper
Simple Web Scrapper to run on AWS Lambda

## Create AWS resources
Lambda function, DynamoDB tables, SQS Queue


## CI/CD with Github Actions
- Generate a AWS IAM user key with Lambda & S3 access
- Save the credentials and Lambda function name in Github Secrets
- Every commit will automatically trigger a build & deploy

