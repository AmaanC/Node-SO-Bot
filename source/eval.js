var cluster = require('cluster'),
    coffee = require('coffee-script');

//execute arbitrary js code in a relatively safe environment
module.exports = function (bot) {
  console.log('loading bot');
function snipAndCodify ( str ) {
  var ret;

  if ( str.length > 400 ) {
    ret = '`' +  str.slice(0, 400) + '` (snip)';
  }
  else {
    ret = '`' + str +'`';
  }

  return ret;
}

function dressUpAnswer ( answerObj ) {
  bot.log( answerObj, 'eval answerObj' );
  var answer = answerObj.answer,
    log = answerObj.log,
    result;

  if ( answer === undefined ) {
    return 'Malformed output from web-worker. If you weren\'t just ' +
      'fooling around trying to break me, raise an issue or contact ' +
      'Zirak';
  }

  result = snipAndCodify( answer );

  if ( log && log.length ) {
    result += ' Logged: ' + snipAndCodify( log );
  }

  return result;
}

  var evil = function ( code, cb ) {
    if (cluster.isMaster) {
      var worker = cluster.fork(),
        timeout;

      if ( code[0] === 'c' ) {
        code = coffee.compile( code.replace(/^c>/, ''), {bare:1} );
      }
      else {
        code = code.replace( /^>/, '' );
      }

      worker.on('message', function ( evt ) {
        console.log('message');
        console.log(evt);
        var type = evt.data.event;
        if ( type === 'start' ) {
          start();
        }
        else {
          finish( dressUpAnswer(evt.data) );
        }
      });

      worker.on('error', function ( error ) {
        bot.log( error, 'eval worker.onerror' );
        finish( error.toString() );
      });

      //and it all boils down to this...
      worker.send( code );
      //so fucking cool.

      function start () {
        if ( timeout ) {
          return;
        }

        timeout = setTimeout(function () {
          finish( 'Maximum execution time exceeded' );
        }, 500 );
      }

      function finish ( result ) {
        clearTimeout( timeout );
        worker.terminate();

        if ( cb && cb.call ) {
          cb( result );
        }
        else {
          console.warn( 'eval did not get callback' );
        }
      }
    } else if (cluster.isWorker) {
      process.send('test');
      var global = this;
      /*most extra functions could be possibly unsafe*/
      var whitey = {
        'Array'              : 1,
        'Boolean'            : 1,
        'console'            : 1,
        'Date'               : 1,
        'Error'              : 1,
        'EvalError'          : 1,
        'exec'               : 1,
        'Function'           : 1,
        'Infinity'           : 1,
        'JSON'               : 1,
        'Math'               : 1,
        'NaN'                : 1,
        'Number'             : 1,
        'Object'             : 1,
        'RangeError'         : 1,
        'ReferenceError'     : 1,
        'RegExp'             : 1,
        'String'             : 1,
        'SyntaxError'        : 1,
        'TypeError'          : 1,
        'URIError'           : 1,
        'atob'               : 1,
        'btoa'               : 1,
        'decodeURI'          : 1,
        'decodeURIComponent' : 1,
        'encodeURI'          : 1,
        'encodeURIComponent' : 1,
        'eval'               : 1,
        'global'             : 1,
        'isFinite'           : 1,
        'isNaN'              : 1,
        'onmessage'          : 1,
        'parseFloat'         : 1,
        'parseInt'           : 1,
        'postMessage'        : 1,
        'self'               : 1,
        'undefined'          : 1,
        'whitey'             : 1,

        /* typed arrays and shit */
        'ArrayBuffer'       : 1,
        'Blob'              : 1,
        'Float32Array'      : 1,
        'Float64Array'      : 1,
        'Int8Array'         : 1,
        'Int16Array'        : 1,
        'Int32Array'        : 1,
        'Uint8Array'        : 1,
        'Uint16Array'       : 1,
        'Uint32Array'       : 1,
        'Uint8ClampedArray' : 1,

        /*
        these properties allow FF to function. without them, a fuckfest of
        inexplicable errors enuses. took me about 4 hours to track these fuckers
        down.
        fuck hell it isn't future-proof, but the errors thrown are uncatchable
        and untracable. so a heads-up. enjoy, future-me!
        */
        'DOMException' : 1,
        'Event'        : 1,
        'MessageEvent' : 1,
        'WorkerMessageEvent': 1
      };

      [ global, Object.getPrototypeOf(global) ].forEach(function ( obj ) {
        Object.getOwnPropertyNames( obj ).forEach(function( prop ) {
          if( whitey.hasOwnProperty(prop) ) {
            return;
          }
          try {
            Object.defineProperty( obj, prop, {
              get : function () {
                /* TEE HEE */
                throw new ReferenceError( prop + ' is not defined' );
              },
              configurable : false,
              enumerable : false
            });
          }
          catch ( e ) {
            delete obj[ prop ];

            if ( obj[ prop ] !== undefined ) {
              obj[ prop ] = null;
            }
          }
        });
      });

      Object.defineProperty( Array.prototype, 'join', {
        writable: false,
        configurable: false,
        enumrable: false,

        value: (function ( old ) {
          return function ( arg ) {
            if ( this.length > 500 || (arg && arg.length > 500) ) {
              throw 'Exception: too many items';
            }

            return old.apply( this, arguments );
          };
        }( Array.prototype.join ))
      });

      /* we define it outside so it'll not be in strict mode */
      var exec = function ( code ) {
        return eval( 'undefined;\n' + code );
      };
      
      (function(){
        "use strict";

        var console = {
          _items : [],
          log : function() {
            console._items.push.apply( console._items, arguments );
          }
        };
        console.error = console.info = console.debug = console.log;

        process.on('message', function ( event ) {
          process.send({
            event : 'start'
          });

          var jsonStringify = JSON.stringify, /*backup*/
            result;

          try {
            result = exec( event.data );
          }
          catch ( e ) {
            result = e.toString();
          }

          /*JSON does not like any of the following*/
          var strung = {
            Function  : true, Error  : true,
            Undefined : true, RegExp : true
          };
          var should_string = function ( value ) {
            var type = ( {} ).toString.call( value ).slice( 8, -1 );

            if ( type in strung ) {
              return true;
            }
            /*neither does it feel compassionate about NaN or Infinity*/
            return value !== value || value === Infinity;
          };

          var reviver = function ( key, value ) {
            var output;

            if ( should_string(value) ) {
              output = '' + value;
            }
            else {
              output = value;
            }

            return output;
          };

          process.send({
            answer : jsonStringify( result, reviver ),
            log    : jsonStringify( console._items, reviver ).slice( 1, -1 )
          });
        });
      })();
    }
  };

  bot.addCommand({
    fun : evil,
    name : '>',
    permissions : {
        del : 'NONE'
    },
    description : 'test',
    unTellable : true
  });
};