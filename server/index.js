const express = require('express');
const bodyParser = require('body-parser');
const winston = require('winston');
// Elasticsearch and kibana are downloaded locally to the main directory of this service, but will be gitignored
// to keep filesize small (filenames are elasticsearch-6.1.0 and kibana-6.1.0-darwin-x86_64)
const Elasticsearch = require('winston-elasticsearch');
const expressWinston = require('express-winston');
const axios = require('axios');
const redis = require('redis');
const bluebird = require('bluebird');
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const AWS = require('aws-sdk');
const Consumer = require('sqs-consumer');

const db = require('../database/index.js');
const calculateDuration = require('../calculator/viewCalculator.js');
const calculateTOD = require('../calculator/dayNightCalculator.js');
const calculateYearWeek = require('../calculator/yearWeekCalculator.js');
const AbandonedTotal = require('../database/AbandonedTotal.js');

const client = redis.createClient();

const app = express();

// AWS setup
// Keys set up by using AWS CLI and running 'aws configure' command in terminal
AWS.config.update({
  region: 'us-west-1'
});

// redis setup
client.on('error', (error) => {
  console.log('Error: ', error);
});

// Setup winston to link to elasticsearch
app.use(expressWinston.logger({
  transports: [
    new Elasticsearch({
      level: 'info'
    })
  ]
}));

// bodyParser setup
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// test route
app.get('/', (req, res) => {
  res.send('Hello World!');
});

const consumerApp = Consumer.create({
  queueUrl: 'https://sqs.us-east-2.amazonaws.com/331983685977/packaged-events',
  handleMessage: (message, done) => {
    console.log('Message being handled...');
    var events = JSON.parse(message.Body).Events;
    console.log('MESSAGE EVENTS IS: ', events);
    client.getAsync(events[0].videoId.toString())
      .then((duration) => {
        if (duration === 'nil') {
          axios.get('http://localhost:1337/vidLengthTest', {
            params: {
              videoId: events[0].videoId
            }
          })
            .then(function(res) {
              var videoLength = res.duration;
              var firstTimestamp = events[0].event_timestamp;
              var dbData = {
                viewInstanceId: events[0].viewInstanceId,
                videoId: events[0].videoId,
                watchTimestamp: firstTimestamp,
                dayFlag: calculateTOD(firstTimestamp),
                yearWeek: calculateYearWeek(firstTimestamp),
                abandonFlag: Math.floor(calculateDuration(events) / (videoLength * (3 / 4)))
              };
              AbandonedTotal.addToTable(dbData);
              return res;
            })
            .then(function(res) {
              return client.setAsync(res.video_id.toString(), res.duration.toString());
            })
            .then(function() {
              console.log('Video logged in redis.');
            });
        } else {
          var videoLength = Number(duration);
          var firstTimestamp = events[0].event_timestamp;
          var dbData = {
            viewInstanceId: events[0].viewInstanceId,
            videoId: events[0].videoId,
            watchTimestamp: firstTimestamp,
            dayFlag: calculateTOD(firstTimestamp),
            yearWeek: calculateYearWeek(firstTimestamp),
            abandonFlag: Math.floor(calculateDuration(events) / (videoLength * (3 / 4)))
          };
          AbandonedTotal.addToTable(dbData);
        }
      });
    console.log('Done');
    done();
  },
  sqs: new AWS.SQS()
});

consumerApp.on('error', (err) => {
  console.log(err.message);
});

app.get('/vidLengthTest', (req, res) => {
  res.send(JSON.stringify({ duration: 600 }));
});

// Deprecated post route from before sqs setup. Commented for posterity
/*
// post route for incoming event packages (route name pending consensus with Event service)
app.post('/view', (req, res) => {
  // events object needs to change depending on whether or not its being tested with artillery

  // use this with artillery
  var events = JSON.parse(req.body.body).events;

  // use this during unit tests and deployment
  // var events = req.body.events;

  // will replace fake route with actual location of video inventory service once ready for deployment
  res.send('data accepted');
  client.getAsync(events[0].videoId.toString())
    .then((duration) => {
      if (duration === 'nil') {
        axios.get('http://localhost:1337/vidLengthTest', {
          params: {
            videoId: events[0].videoId
          }
        })
          .then(function(res) {
            var videoLength = res.duration;
            var firstTimestamp = events[0].event_timestamp;
            var dbData = {
              viewInstanceId: events[0].viewInstanceId,
              videoId: events[0].videoId,
              watchTimestamp: firstTimestamp,
              dayFlag: calculateTOD(firstTimestamp),
              yearWeek: calculateYearWeek(firstTimestamp),
              abandonFlag: Math.floor(calculateDuration(events) / (videoLength * (3 / 4)))
            };
            AbandonedTotal.addToTable(dbData);
            return res;
          })
          .then(function(res) {
            return client.setAsync(res.video_id.toString(), res.duration.toString());
          })
          .then(function() {
            console.log('Video logged in redis.');
          });
      } else {
        var res = { duration: Number(duration) };
        var videoLength = res.duration;
        var firstTimestamp = events[0].event_timestamp;
        var dbData = {
          viewInstanceId: events[0].viewInstanceId,
          videoId: events[0].videoId,
          watchTimestamp: firstTimestamp,
          dayFlag: calculateTOD(firstTimestamp),
          yearWeek: calculateYearWeek(firstTimestamp),
          abandonFlag: Math.floor(calculateDuration(events) / (videoLength * (3 / 4)))
        };
        AbandonedTotal.addToTable(dbData);
      }
    });
});
*/

const port = 1337;

// starts local server
app.listen(port, () => {
  console.log(`App listening on port ${port}!`);
});

// starts sqs polling
consumerApp.start();

module.exports = app;