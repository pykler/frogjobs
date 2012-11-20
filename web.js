var async     = require('async')
  , express   = require('express')
  , util      = require('util')
  , path      = require('path')
  , mongoose  = require('mongoose')
  , http      = require('http');

// connect to the db
var db = mongoose.createConnection(process.env.MONGODB);


// mongoose schema
var userSchema = new mongoose.Schema({
  fbid: String,
  name: String,
  times: {
    created_at: { type: Date, default: Date.now },
    last_login: { type: Date, default: Date.now }
  }
});
var User = db.model('User', userSchema);

var jobSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'userSchema' },
  description: String,
  category: String,
  address: String,
  end_time: { type: Date, default: Date.now },
  wage: Number,
  wage_type: {type: String, enum: ['hour', 'job']}
});
var Job = db.model('Job', jobSchema);

// create an express webserver
var app = express();
app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.static(path.join(__dirname, 'public')));
  // set this to a secret value to encrypt session cookies
  app.use(express.session({ secret: process.env.SESSION_SECRET || 'secret123' }));
  app.use(require('faceplate').middleware({
    app_id: process.env.FACEBOOK_APP_ID,
    secret: process.env.FACEBOOK_SECRET,
    scope:  'user_likes,user_photos,user_photo_video_tags'
  }));
  app.use(function(req, res, next) {
    res.locals.host =  req.headers['host'];
    next();
  });
  app.use(function(req, res, next) {
    res.locals.scheme = req.headers['x-forwarded-proto'] || 'http';
    next();
  });
  app.use(function(req, res, next) {
    res.locals.url = function(path) {
      return res.locals.scheme + res.locals.url_no_scheme(path);
    };
    next();
  });
  app.use(function(req, res, next) {
    res.locals.url_no_scheme = function(path) {
      return '://' + res.locals.host + (path || '');
    };
    next();
  });
});

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

function render_page(req, res) {
  req.facebook.app(function(app) {
    req.facebook.me(function(user) {
      var userobj;
      User.find({fbid: user.id}).exec(function() {
      });
      if (userobj === undefined) {
        userobj = new User({
          fbid: user.id,
          name: user.name
        });
      } else {
        userobj.times.last_login = Date.now();
      }
      userobj.save();
      res.render('index.ejs', {
        layout:    false,
        req:       req,
        app:       app,
        user:      user,
        userobj:   userobj
      });
    });
  });
}

function handle_facebook_request(req, res) {
  // if the user is logged in
  if (req.facebook.token) {

    async.parallel([
      function(cb) {
        // query 4 friends and send them to the socket for this socket id
        req.facebook.get('/me/friends', { limit: 4 }, function(friends) {
          req.friends = friends;
          cb();
        });
      },
      function(cb) {
        // query 16 photos and send them to the socket for this socket id
        req.facebook.get('/me/photos', { limit: 16 }, function(photos) {
          req.photos = photos;
          cb();
        });
      },
      function(cb) {
        // query 4 likes and send them to the socket for this socket id
        req.facebook.get('/me/likes', { limit: 4 }, function(likes) {
          req.likes = likes;
          cb();
        });
      },
      function(cb) {
        // use fql to get a list of my friends that are using this app
        req.facebook.fql('SELECT uid, name, is_app_user, pic_square FROM user WHERE uid in (SELECT uid2 FROM friend WHERE uid1 = me()) AND is_app_user = 1', function(result) {
          req.friends_using_app = result;
          cb();
        });
      }
    ], function() {
      render_page(req, res);
    });

  } else {
    render_page(req, res);
  }
}

app.get('/', handle_facebook_request);
app.post('/', handle_facebook_request);
