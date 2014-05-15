var util = require('util');
var Twit = require('twit');
var sets = require('simplesets');
var MongoClient = require('mongodb').MongoClient
var format = require('util').format;
var _ = require('underscore');


// set up process.env for sendgrid and twitter api and mongo hq keys
var sendgrid = null;
if (process.env.SENDGRID_USERNAME && process.env.SENDGRID_PASSWORD) {
  sendgrid = require('sendgrid')(process.env.SENDGRID_USERNAME, process.env.SENDGRID_PASSWORD);
}

var consumerKey = process.env.CONSUMER_KEY;
var consumerSecret = process.env.CONSUMER_SECRET;
var accessToken = process.env.ACCESS_TOKEN;
var accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;
var dbConnStr = process.env.MONGOHQ_URL;

var followersPath = 'followers/ids';

// use your own username
var user = 'boundsj';
var emailAddress = 'jesse@rebounds.net'

var T = new Twit({
  consumer_key: consumerKey,
  consumer_secret: consumerSecret,
  access_token: accessToken,
  access_token_secret: accessTokenSecret
});

var collection;
var database;
var lostFollowers;
var gainedFollowers;
var twitterResponse;
var resolvedLostFollowers = new Array();
var resolvedGainedFollowers = new Array();
var userIdResolutionsReq = 0;
var userIdResolutions = 0;

util.log('GET: ' + followersPath);
T.get(followersPath, {screen_name: user}, processTwitterResponse);

function processTwitterResponse(err, reply) {
  if(err) throw err;

  util.log('GET: successful');
  twitterResponse = reply;

  util.log('Connecting to db...');
  MongoClient.connect(dbConnStr, function(err, db) {
    if(err) throw err;
    util.log('Connected.');

    database = db;
    collection = database.collection('friend_ids');
    collection.find({'_id': 'friends'}).toArray(processCollection);
  });
}

function processCollection(err, results) {
  if(err) throw err;

  if (results.length) {
    var followersFromDB = results[0];
    util.log('Analyzing followers...');

    var previousSet = new sets.Set(followersFromDB['ids']);
    var currentSet = new sets.Set(twitterResponse['ids']);
    lostFollowers = previousSet.difference(currentSet).array();
    gainedFollowers = currentSet.difference(previousSet).array();

    if (lostFollowers.length) {
      T.get('users/lookup', {user_id: lostFollowers}, handleUsersLookup);
      userIdResolutionsReq++;
    }
    if (gainedFollowers.length) {
      T.get('users/lookup', {user_id: gainedFollowers}, handleUsersLookup);
      userIdResolutionsReq++;
    }
    if (userIdResolutionsReq === 0) {
      collection.update({'_id': 'friends'}, {$set: {'ids': twitterResponse['ids']}}, {'upsert': true}, updateCollectionCallback);
    }
  }
}

function handleUsersLookup(err, reply) {
  if (err) throw err;
  var resolved = _.map(reply, function(user) { return {'name': user.name, 'screenName': user.screen_name, 'id': user.id} });

  if (_.contains(lostFollowers, resolved[0].id)) {
    lostFollowers = resolved;
    console.log('lost:', lostFollowers);
  } else {
    gainedFollowers = resolved;
    console.log('gained:', gainedFollowers);
  }

  userIdResolutions++;

  if (userIdResolutions === userIdResolutionsReq) {
    collection.update({'_id': 'friends'}, {$set: {'ids': twitterResponse['ids']}}, {'upsert': true}, updateCollectionCallback);
  }
}

function updateCollectionCallback(err, docs) {
  if(err) throw err;
  database.close();

  if (lostFollowers.length || gainedFollowers.length) {
    sendgrid.send({
      to: emailAddress,
      from: 'twitterdelta@rebounds.net',
      subject: 'Your followers changed!',
      text: 'lost: \n' + _.pluck(lostFollowers, 'screenName') + '\n\n' + 'gained: \n' + _.pluck(gainedFollowers, 'screenName')
    }, function(err, json) {
      if (err) { return console.error(err); }
      console.log(json);
    });
  }
}

