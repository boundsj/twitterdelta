var util = require('util');
var Twit = require('twit');
var sets = require('simplesets');
var MongoClient = require('mongodb').MongoClient
var format = require('util').format;

var consumerKey = process.env.CONSUMER_KEY;
var consumerSecret = process.env.CONSUMER_SECRET;
var accessToken = process.env.ACCESS_TOKEN;
var accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;
var dbConnStr = process.env.MONGOHQ_URL;

var path = 'followers/ids';
var user = 'boundsj';

var T = new Twit({
  consumer_key: consumerKey,
  consumer_secret: consumerSecret,
  access_token: accessToken,
  access_token_secret: accessTokenSecret
});


util.log('GET: ' + path);
T.get(path, {screen_name: user}, function(err, reply) {
  if(err) throw err;

  util.log('GET: successful');

  util.log('Connecting to ' + dbConnStr + '...');
  MongoClient.connect(dbConnStr, function(err, db) {
    if(err) throw err;
    util.log('Connected.');

    var collection = db.collection('friend_ids');

    collection.find({'_id': 'friends'}).toArray(function(err, results) {
      if(err) throw err;

      if (results.length) {
        var result = results[0];
        util.log('Analyzing followers...');

        var previousSet = new sets.Set(result['ids']);
        var currentSet = new sets.Set(reply['ids']);

        // temp fake loss of follower
        //currentSet.remove(reply['ids'][0]);

        // compare diff of sets
        var difference = previousSet.difference(currentSet).array();

        var lostFollowers = new Array();
        var gainedFollowers = new Array();

        difference.forEach(function(element) {
          if (currentSet.has(element)) {
            gainedFollowers.push(element);
          } else {
            lostFollowers.push(element);
          }
        });

        util.log('Report:');
        util.log('lost: ' + lostFollowers);
        util.log('gained: ' + gainedFollowers);
      }

      // 'upsert' latest followers
      collection.update({'_id': 'friends'}, {$set: {'ids': reply['ids']}}, {'upsert': true}, function(err, docs) {
        if(err) throw err;
        db.close();
      });
    });
  });
});

