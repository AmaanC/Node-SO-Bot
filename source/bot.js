"use strict";

var IO = require('./IO');

// Fake localStorage
var localStorage = {};

require('./util');

var bot = {
	invocationPattern : '``',

	commands : {}, //will be filled as needed
	commandDictionary : require('./suggestionDict'),
	listeners : [],
	info : {
		invoked   : 0,
		learned   : 0,
		forgotten : 0,
		start     : new Date()
	},
	users : {}, //will be filled in build

	parseMessage : function ( msgObj ) {
		if ( !this.validateMessage(msgObj) ) {
			bot.log( msgObj, 'parseMessage invalid' );
			return;
		}

		var msg = this.prepareMessage( msgObj ),
			id = msg.get( 'user_id' );
		bot.log( msg, 'parseMessage valid' );

		if ( this.banlist.contains(id) ) {
			bot.log( msgObj, 'parseMessage banned' );

			//tell the user he's banned only if he hasn't already been told
			if ( !this.banlist[id].told ) {
				msg.reply( 'You iz in mindjail' );
				this.banlist[ id ].told = true;
			}
			return;
		}

		try {
			//it wants to execute some code
			if ( /^c?>/.test(msg) ) {
				this.eval( msg.toString(), msg.directreply.bind(msg) );
			}
			//or maybe some other action.
			else {
				this.invokeAction( msg );
			}
		}
		catch ( e ) {
			var err = 'Could not process input. Error: ' + e.message;

			if ( e.lineNumber ) {
				err += ' on line ' + e.lineNumber;
			}
			//column isn't part of ordinary errors, it's set in custom ones
			if ( e.column ) {
				err += ' on column ' + e.column;
			}

			msg.directreply( err );
			//make sure we have it somewhere
			console.error( e.stack );
		}
		finally {
			this.info.invoked += 1;
		}
	},

	//this conditionally calls execCommand or callListeners, depending on what
	// the input. if the input begins with a command name, it's assumed to be a
	// command. otherwise, it tries matching against the listener.
	invokeAction : function ( msg ) {
		var possibleName = msg.trim().replace( /^\/\s*/, '' ).split( ' ' )[ 0 ],
			cmd = this.getCommand( possibleName ),

			//this is the best name I could come up with
			//messages beginning with / want to specifically invoke a command
			coolnessFlag = msg.startsWith('/') ? !cmd.error : true;

		if ( !cmd.error ) {
			this.execCommand( cmd, msg );
		}
		else if ( coolnessFlag ) {
			coolnessFlag = this.callListeners( msg );
		}

		//nothing to see here, move along
		if ( coolnessFlag ) {
			return;
		}

		msg.reply( this.giveUpMessage(cmd.guesses) );
	},

	giveUpMessage : function ( guesses ) {
		//man, I can't believe it worked...room full of nachos for me
		var errMsg = 'That didn\'t make much sense.';
		if ( guesses && guesses.length ) {
			errMsg += ' Maybe you meant: ' + guesses.join( ', ' );
		}
		//mmmm....nachos
		else {
			errMsg += ' Use the `!!/help` command to learn more.';
		}
		//wait a minute, these aren't nachos. these are bear cubs.
		return errMsg;
		//good mama bear...nice mama bear...tasty mama be---
	},

	execCommand : function ( cmd, msg ) {
		bot.log( cmd, 'execCommand calling' );

		if ( !cmd.canUse(msg.get('user_id')) ) {
			msg.reply([
				'You do not have permission to use the command ' + cmd.name,
				"I'm afraid I can't let you do that, " + msg.get('user_name')
			].random());
			return;
		}

		var args = this.Message(
				msg.replace( /^\/\s*/, '' ).slice( cmd.name.length ).trim(),
				msg.get()
			),
			//it always amazed me how, in dynamic systems, the trigger of the
			// actions is always a small, nearly unidentifiable line
			//this line right here activates a command
			res = cmd.exec( args );

		if ( res ) {
			msg.reply( res );
		}
	},

	prepareMessage : function ( msgObj ) {
		msgObj = this.adapter.transform( msgObj );

		//decode markdown and html entities.
		var msg = IO.htmlToMarkdown( msgObj.content ); //#150
		msg = IO.decodehtmlEntities( msg );

		//fixes issues #87 and #90 globally
		msg = msg.replace( /\u200b|\u200c/g, '' );

		return this.Message(
			msg.slice( this.invocationPattern.length ).trim(),
			msgObj );
	},

	validateMessage : function ( msgObj ) {
		var msg = msgObj.content.trim();

		//a bit js bot specific...make sure it isn't just !!! all round. #139
		if ( this.invocationPattern === '!!' && (/^!!!+$/).test(msg) ) {
			console.log('special skip');
			return false;
		}

		return (
			//make sure we don't process our own messages,
			msgObj.user_id !== bot.adapter.user_id &&
			//and the message begins with the invocationPattern
			msg.startsWith( this.invocationPattern ) );
	},

	addCommand : function ( cmd ) {
		if ( !cmd.exec || !cmd.del ) {
			cmd = this.Command( cmd );
		}
		if ( cmd.learned ) {
			this.info.learned += 1;
		}
		cmd.invoked = 0;

		this.commands[ cmd.name ] = cmd;
		this.commandDictionary.trie.add( cmd.name );
	},

	//gee, I wonder what this will return?
	commandExists : function ( cmdName ) {
		return this.commands.hasOwnProperty( cmdName );
	},

	//if a command named cmdName exists, it returns that command object
	//otherwise, it returns an object with an error message property
	getCommand : function ( cmdName ) {
		var lowerName = cmdName.toLowerCase();

		if ( this.commandExists(lowerName) ) {
			return this.commands[ lowerName ];
		}

		//not found, onto error reporting
		//set the error margin according to the length
		this.commandDictionary.maxCost = Math.floor( cmdName.length / 5 + 1 );

		var msg = 'Command ' + cmdName + ' does not exist.',
		//find commands resembling the one the user entered
		guesses = this.commandDictionary.search( cmdName );

		//resembling command(s) found, add them to the error message
		if ( guesses.length ) {
			msg += ' Did you mean: ' + guesses.join( ', ' );
		}

		return { error : msg, guesses : guesses };
	},

	//the function women think is lacking in men
	listen : function ( regex, fun, thisArg ) {
		if ( Array.isArray(regex) ) {
			regex.forEach(function ( reg ) {
				this.listen( reg, fun, thisArg );
			}, this);
		}
		else {
			this.listeners.push({
				pattern : regex,
				fun : fun,
				thisArg: thisArg
			});
		}
	},

	callListeners : function ( msg ) {
		function callListener ( listener ) {
			var match = msg.exec( listener.pattern ), resp;

			if ( match ) {
				resp = listener.fun.call( listener.thisArg, msg );

				bot.log( match, resp );
				if ( resp ) {
					msg.reply( resp );
				}
				return resp !== false;
			}
		}

		return this.listeners.some( callListener );
	},

	stoplog : false,
	log : function () {
		if ( !this.stoplog ) {
			console.log.apply( console, arguments );
		}
	},

	stop : function () {
		this.stopped = true;
	},
	continue : function () {
		this.stopped = false;
	},

    devMode : false,
    activateDevMode : function ( pattern ) {
        this.devMode = true;
        this.invocationPattern = pattern || 'beer!';
        IO.events.userjoin.length = 0;
        this.validateMessage = function ( msgObj ) {
            return msgObj.content.trim().startsWith( this.invocationPattern );
        };
    }
};

//a place to hang your coat and remember the past. provides an abstraction over
// localStorage or whatever data-storage will be used in the future.
bot.memory = {
	saveInterval : 900000, //15(min) * 60(sec/min) * 1000(ms/sec) = 900000(ms)

	data : {},

	get : function ( name, defaultVal ) {
		if ( !this.data[name] ) {
			this.set( name, defaultVal || {} );
		}

		return this.data[ name ];
	},

	set : function ( name, val ) {
		this.data[ name ] = val;
	},

	loadAll : function () {
		var self = this;

		Object.iterate( localStorage, function ( key, val ) {
			if ( key.startsWith('bot_') ) {
				console.log( key, val );
				self.set( key.replace(/^bot_/, ''), JSON.parse(val) );
			}
		});
	},

	save : function ( name ) {
		if ( name ) {
			localStorage[ 'bot_' + name ] = JSON.stringify( this.data[name] );
			return;
		}

		var self = this;
		Object.keys( this.data ).forEach(function ( name ) {
			self.save( name );
		});

		this.saveLoop();
	},

	saveLoop : function () {
		clearTimeout( this.saveIntervalId );
		setTimeout( this.saveLoop.bind(this), this.saveInterval );
	}
};

bot.memory.loadAll();
process.on('SIGINT', function () {
	bot.memory.save();
	process.exit();
});
bot.memory.saveLoop();

bot.banlist = bot.memory.get( 'ban' );
bot.banlist.contains = function ( id ) {
	return this.hasOwnProperty( id );
};
bot.banlist.add = function ( id ) {
	this[ id ] = { told : false };
	bot.memory.save( 'ban' );
};
bot.banlist.remove = function ( id ) {
	if ( this.contains(id) ) {
		delete this[ id ];
		bot.memory.save( 'ban' );
	}
};

//some sort of pseudo constructor
bot.Command = function ( cmd ) {
	cmd.name = cmd.name.toLowerCase();
	cmd.thisArg = cmd.thisArg || cmd;

	cmd.permissions = cmd.permissions || {};
	cmd.permissions.use = cmd.permissions.use || 'ALL';
	cmd.permissions.del = cmd.permissions.del || 'NONE';

	cmd.description = cmd.description || '';
	cmd.creator = cmd.creator || 'God';
	cmd.invoked = 0;

	//make canUse and canDel
	[ 'Use', 'Del' ].forEach(function ( perm ) {
		var low = perm.toLowerCase();

		cmd[ 'can' + perm ] = function ( usrid ) {
			var canDo = this.permissions[ low ];

			if ( canDo === 'ALL' ) {
				return true;
			}
			else if ( canDo === 'NONE' ) {
				return false;
			}
			else if ( canDo === 'OWNER' ) {
				return bot.isOwner( usrid );
			}
			return canDo.indexOf( usrid ) > -1;
		};
	});

	cmd.exec = function () {
		this.invoked += 1;

		return this.fun.apply( this.thisArg, arguments );
	};

	cmd.del = function () {
		bot.info.forgotten += 1;
		delete bot.commands[ cmd.name ];
		bot.commandDictionary.trie.del(cmd.name);
	};

	return cmd;
};

//a normally priviliged command which can be executed if enough people use it
bot.CommunityCommand = function ( command, req ) {
	var cmd = this.Command( command ),
		used = {},
		old_execute = cmd.exec,
		old_canUse  = cmd.canUse;

	req = req || 2;

	cmd.canUse = function () {
		return true;
	};
	cmd.exec = function ( msg ) {
		var err = register( msg.get('user_id') );
		if ( err ) {
			bot.log( err );
			return err;
		}

		used = {};

		return old_execute.apply( cmd, arguments );
	};

	return cmd;

	//once again, a switched return statement: truthy means a message, falsy
	// means to go on ahead
	function register ( usrid ) {
		if ( old_canUse.call(cmd, usrid) ) {
			return false;
		}

		clean();
		var count = Object.keys( used ).length,
			needed = req - count;
		bot.log( used, count, req );

		if ( usrid in used ) {
			return 'Already registered; still need {0} more'.supplant( needed );
		}

		used[ usrid ] = new Date();
		needed -= 1;

		if ( needed > 0 ) {
			return 'Registered; need {0} more to execute'.supplant( needed );
		}

		bot.log( 'should execute' );
		return false; //huzzah!
	}

	function clean () {
		var tenMinsAgo = new Date();
		tenMinsAgo.setMinutes( tenMinsAgo.getMinutes() - 10 );

		Object.keys( used ).reduce( rm, used );
		function rm ( ret, key ) {
			if ( ret[key] < tenMinsAgo ) {
				delete ret[ key ];
			}
			return ret;
		}
	}
};

bot.Message = function ( text, msgObj ) {
	//"casting" to object so that it can be extended with cool stuff and
	// still be treated like a string
	var ret = Object( text );
	ret.content = text;

	var rawSend = function ( text ) {
		bot.adapter.out.add( text, msgObj.room_id );
	};
	var deliciousObject = {
		send : rawSend,

		reply : function ( resp, user_name ) {
			var prefix = bot.adapter.reply( user_name || msgObj.user_name );
			rawSend( prefix + ' ' + resp );
		},
		directreply : function ( resp ) {
			var prefix = bot.adapter.directreply( msgObj.message_id );
			rawSend( prefix + ' ' + resp );
		},

		//parse() parses the original message
		//parse( true ) also turns every match result to a Message
		//parse( msgToParse ) parses msgToParse
		//parse( msgToParse, true ) combination of the above
		parse : function ( msg, map ) {
			// parse( true )
			if ( Boolean(msg) === msg ) {
				map = msg;
				msg = text;
			}
			var parsed = bot.parseCommandArgs( msg || text );

			// parse( msgToParse )
			if ( !map ) {
				return parsed;
			}

			// parse( msgToParse, true )
			return parsed.map(function ( part ) {
				return bot.Message( part, msgObj );
			});
		},

		//execute a regexp against the text, saving it inside the object
		exec : function ( regexp ) {
			var match = regexp.exec( text );
			this.matches = match || [];

			return match;
		},

		findUserId   : bot.users.findUserId,
		findUsername : bot.users.findUsername,

		codify : bot.adapter.codify.bind( bot.adapter ),
		escape : bot.adapter.escape.bind( bot.adapter ),
		link   : bot.adapter.link.bind( bot.adapter ),

		//retrieve a value from the original message object, or if no argument
		// provided, the msgObj itself
		get : function ( what ) {
			if ( !what ) {
				return msgObj;
			}
			return msgObj[ what ];
		},
		set : function ( what, val ) {
			msgObj[ what ] = val;
			return msgObj[ what ];
		}
	};

	Object.iterate( deliciousObject, function ( key, prop ) {
		ret[ key ] = prop;
	});

	return ret;
};

bot.isOwner = function ( usrid ) {
	var user = this.users[ usrid ];
	return user && ( user.is_owner || user.is_moderator );
};

IO.register( 'input', bot.parseMessage, bot );

// sigh.jpg
var commands = {
	help : function ( args ) {
		if ( args && args.length ) {

			var cmd = bot.getCommand( args.toLowerCase() );
			if ( cmd.error ) {
				return cmd.error;
			}

			var desc = cmd.description || 'No info is available';

			return args + ': ' + desc;
		}

		return 'Information on interacting with me can be found at ' +
			'[this page](https://github.com/Zirak/SO-ChatBot/' +
			'wiki/Interacting-with-the-bot)';
	},

	listen : function ( msg ) {
		var ret = bot.callListeners( msg );
		if ( !ret ) {
			return bot.giveUpMessage();
		}
	},

	eval : function ( msg, cb ) {
		cb = cb || msg.directreply.bind( msg );

		return bot.eval( msg, cb );
	},
	coffee : function ( msg, cb ) {
		//yes, this is a bit yucky
		var arg = bot.Message( 'c> ' + msg, msg.get() );
		return commands.eval( arg, cb );
	},

	refresh : function() {
		window.location.reload();
	},

	forget : function ( args ) {
		var name = args.toLowerCase(),
			cmd = bot.getCommand( name );

		if ( cmd.error ) {
			return cmd.error;
		}

		if ( !cmd.canDel(args.get('user_id')) ) {
			return 'You are not authorized to delete the command ' + args;
		}

		cmd.del();
		return 'Command ' + name + ' forgotten.';
	},

	//a lesson on semi-bad practices and laziness
	//chapter III
	info : function ( args ) {
		if ( args.content ) {
			return commandFormat( args.content );
		}

		var info = bot.info;
		return timeFormat() + ', ' + statsFormat();

		function commandFormat ( commandName ) {
			var cmd = bot.getCommand( commandName );

			if ( cmd.error ) {
				return cmd.error;
			}
			var ret =  'Command {name}, created by {creator}'.supplant( cmd );

			if ( cmd.date ) {
				ret += ' on ' + cmd.date.toUTCString();
			}

			if ( cmd.invoked ) {
				ret += ', invoked ' + cmd.invoked + ' times';
			}
			else {
				ret += ' but hasn\'t been used yet';
			}

			return ret;
		}

		function timeFormat () {
			var format = 'I awoke on {0} (that\'s about {1} ago)',

				awoke = info.start.toUTCString(),
				ago = Date.timeSince( info.start );

			return format.supplant( awoke, ago );
		}

		function statsFormat () {
			var ret = [],
				but = ''; //you'll see in a few lines

			if ( info.invoked ) {
				ret.push( 'got invoked ' + info.invoked + ' times' );
			}
			if ( info.learned ) {
				but = 'but ';
				ret.push( 'learned ' + info.learned + ' commands' );
			}
			if ( info.forgotten ) {
				ret.push( but + 'forgotten ' + info.forgotten + ' commands' );
			}
			if ( Math.random() < 0.15 ) {
				ret.push( 'teleported ' + Math.rand(100) + ' goats' );
			}

			return ret.join( ', ' ) || 'haven\'t done anything yet!';
		}
	}
};

commands.listcommands = (function () {
var partition = function ( list, maxSize ) {
	var size = 0, last = [];

	var ret = list.reduce(function partition ( ret, item ) {
		var len = item.length + 2; //+1 for comma, +1 for space

		if ( size + len > maxSize ) {
			ret.push( last );
			last = [];
			size = 0;
		}
		last.push( item );
		size += len;

		return ret;
	}, []);

	if ( last.length ) {
		ret.push( last );
	}

	return ret;
};

return function ( args ) {
	var commands = Object.keys( bot.commands ),
		user_name = args.get( 'user_name' ),
		// 500 is the max, -2 for @ and space.
		maxSize = 498 - user_name.length,
		//TODO: only call this when commands were learned/forgotten since last
		partitioned = partition( commands, maxSize );

	return partitioned.invoke( 'join', ', ' ).join( '\n' );
};
})();

commands.eval.async = commands.coffee.async = true;

commands.tell = function ( args ) {
	var parts = args.split( ' ' );
	bot.log( args.valueOf(), parts, '/tell input' );

	var replyTo = parts[ 0 ],
		cmdName = parts[ 1 ],
		cmd;

	if ( !replyTo || !cmdName ) {
		return 'Invalid /tell arguments. Use /help for usage info';
	}

	cmdName = cmdName.toLowerCase();
	cmd = bot.getCommand( cmdName );
	if ( cmd.error ) {
		return cmd.error +
			' (note that /tell works on commands, it\'s not an echo.)';
	}

	if ( cmd.unTellable ) {
		return 'Command ' + cmdName + ' cannot be used in `/tell`.';
	}

	if ( !cmd.canUse(args.get('user_id')) ) {
		return 'You do not have permission to use command ' + cmdName;
	}

	//check if the user's being a fag
	if ( /^@/.test(replyTo) ) {
		return 'Don\'t be annoying, drop the @, nobody likes a double-ping.';
	}

	//check if the user wants to reply to a message
	var direct = false,
		extended = {};
	if ( /^:?\d+$/.test(replyTo) ) {
		extended.message_id = replyTo.replace( /^:/, '' );
		direct = true;
	}
	else {
		extended.user_name = replyTo;
	}

	var msgObj = Object.merge( args.get(), extended ),
		cmdArgs = bot.Message( parts.slice(2).join(' '), msgObj );

	//this is an ugly, but functional thing, much like your high-school prom
	// date to make sure a command's output goes through us, we simply override
	// the standard ways to do output
	var reply = cmdArgs.reply.bind( cmdArgs ),
		directreply = cmdArgs.directreply.bind( cmdArgs );

	cmdArgs.reply = cmdArgs.directreply = cmdArgs.send = callFinished;

	bot.log( cmdArgs, '/tell calling ' + cmdName );

	//if the command is async, it'll accept a callback
	if ( cmd.async ) {
		cmd.exec( cmdArgs, callFinished );
	}
	else {
		callFinished( cmd.exec(cmdArgs) );
	}

	function callFinished ( res ) {
		if ( !res ) {
			return;
		}

		if ( direct ) {
			directreply( res );
		}
		else {
			reply( res );
		}
	}
};

var descriptions = {
	eval : 'Forwards message to javascript code-eval',
	coffee : 'Forwards message to coffeescript code-eval',
	forget : 'Forgets a given command. `/forget cmdName`',
	help : 'Fetches documentation for given command, or general help article.' +
		' `/help [cmdName]`',
	info : 'Grabs some stats on my current instance or a command.' +
		' `/info [cmdName]`',
	listcommands : 'Lists commands. `/listcommands`',
	listen : 'Forwards the message to my ears (as if called without the /)',
	refresh : 'Reloads the browser window I live in',
	tell : 'Redirect command result to user/message.' +
		' /tell `msg_id|usr_name cmdName [cmdArgs]`'
};

//only allow owners to use certain commands
var privilegedCommands = {
	die : true, live  : true,
	ban : true, unban : true,
	refresh : true
};
//voting-based commands for unpriviledged users
var communal = {
	die : true, ban : true
};
//commands which can't be used with /tell
var unTellable = {
	tell : true, forget : true
};

Object.iterate( commands, function ( cmdName, fun ) {
	var cmd = {
		name : cmdName,
		fun  : fun,
		permissions : {
			del : 'NONE',
			use : privilegedCommands[ cmdName ] ? 'OWNER' : 'ALL'
		},
		description : descriptions[ cmdName ],
		unTellable : unTellable[ cmdName ],
		async : commands[ cmdName ].async
	};

	if ( communal[cmdName] ) {
		cmd = bot.CommunityCommand( cmd );
	}
	bot.addCommand( cmd );
});

module.exports = bot;