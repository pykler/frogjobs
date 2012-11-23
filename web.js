var async     = require('async')
  , express   = require('express')
  , util      = require('util')
  , path      = require('path')
  , mongoose  = require('mongoose')
  , io        = require('socket.io')
  , path      = require('path')
  , http      = require('http');

// connect to the db
var db = mongoose.createConnection(process.env.MONGODB);


// mongoose schema
var userSchema = new mongoose.Schema({
  fbid: String,
  name: String,
  facebook: mongoose.Schema.Types.Mixed,
  times: {
    created_at: { type: Date, default: Date.now },
    last_login: { type: Date, default: Date.now }
  }
});
var User = db.model('User', userSchema);

var jobSchema = new mongoose.Schema({
  _creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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
  app.use(function(req, res, next) {
    req.facebook.app(function(app) {
      req.facebook.me(function(user) {
        // setting the locals up
        res.locals.app = app;
        res.locals.user = user;
        // setting up userobj
        if (user) {
          User.findOne({fbid: user.id}).exec(function(err, userobj) {
            if (userobj) {
              userobj.times.last_login = Date.now();
            } else {
              userobj = new User({
                fbid: user.id,
                name: user.name,
                facebook: user
              });
            }
            res.locals.userobj = userobj;
            userobj.save();
            next();
          });
        } else {
          next();
        }
      });
    });
  });
});

var http_app = http.createServer(app);

http_app.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

var sio = io.listen(http_app, { log: false });
// sio.set('log level', 2); // remove the debug messages
sio.sockets.on('connection', function (socket) {
    console.log('A socket connected!');
});

function render_page(req, res) {
  Job.find({"end_time" : {"$gte": new Date()}}).sort({"_id": -1}).populate('_creator').exec(function(err,jobs) {
    res.render('index.ejs', {
      layout:    false,
      req:       req,
      jobs:      jobs
    });
  });
}

function homepage_request(req, res) {
  // if the user is logged in
  if (req.facebook.token) {
    async.parallel([
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

app.get('/', homepage_request);
app.post('/', homepage_request);

function post_job(req, res) {
  var job = new Job({
    _creator: res.locals.userobj,
    description: req.param('description'),
    wage: req.param('wage'),
    wage_type: req.param('wage_type'),
    end_time: new Date(req.param('end_time'))
  });
  job.save(function(err){
    if (err) {
      res.json({
        'result': 'An error occured',
        'identifier': 'error',
        'error': null
      });
    } else {
      Job.findOne({_id: job._id}).populate('_creator').exec(function(err, _job) {
        if (!err) {
          sio.sockets.emit('jobs', _job);
        }
      });
      res.json({
        'result': 'success',
        'identifier': 'job',
        'job': job
      });
    }
  });
}

app.post('/post-job/', post_job);

function get_jobs(req, res) {

  Job.find()
  .populate('_creator')
  .exec(function(err, _jobs) {
    if (err) {
      res.json({
        'result': 'An error occured',
        'identifier': 'error',
        'error': null
      });
    } else {
      res.json({
        'result': 'success',
        'identifier': 'jobs',
        'jobs': _jobs
      });
    }
  });

}

app.get('/get-jobs/', get_jobs);

function job_ejs(req, res) {
  res.sendfile(path.resolve(__dirname, 'views/job.ejs'));
}

app.get('/job.ejs', job_ejs);
