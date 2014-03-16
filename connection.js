var req = require('request');
var jsdom = require('jsdom');

var bot = require('./source/bot');

var WebSocketClient = require('websocket').client;

var j = req.jar();
var request = req.defaults({jar: j});

// The login process works in two stages. First, you go to the login page. From the login page, you take the fkey,
// and then you send a POST request to login, using your details and the fkey

// Similarly, the initLogin function here visits the login page, gets the fkey, and passes it all to auth, which does the authentication
// using a POST request with all the details
var initLogin = function (getURL, formURL, formObj, callback) {
    request.get({
        url: getURL
    }, function (e, res, body) {
        jsdom.env(body, function (errors, window) {
            auth(window, formURL, formObj, callback);
        });
    });
};

// Note that the auth function does append the fkey to the formObj sent in the POST request
var auth = function (window, formURL, formObj, callback) {
    var fkey = window.document.querySelector('input[name="fkey"]').value;
    var obj = formObj;
    obj.fkey = fkey;

    request.post({
        followAllRedirects: true,
        url: formURL,
        form: obj
    }, function(error, response, body) {
        jsdom.env(body, function (errors, window){
            callback();
        });
    });
};

var chatFkey;

var loginChat = function (callback) {
    console.log('Getting fkey on chat');
    request.get({
        url: 'http://chat.stackoverflow.com'
    }, function(error, response, body) {
        jsdom.env(body, function (errors, window) {
            chatFkey = window.document.querySelector('input[name="fkey"]').value;

            callback();
        });
    });
};

// FIXME overwritting sendToRoom
var sendMessage = bot.adapter.out.sendToRoom = function (text) {
    if (!chatFkey) {
        console.log('fkey for chat missing');
        return false;
    }

    request.post({
        url: 'http://chat.stackoverflow.com/chats/1/messages/new',
        form: {
            text: text,
            fkey: chatFkey
        }
    }, function(error, response, body) {
        console.log('Message sent', body);
    });
};

var loginSEOpenID = function (email, password, callback) {
    initLogin(
        'https://openid.stackexchange.com/account/login',
        'https://openid.stackexchange.com/account/login/submit/',
        {
            email: email,
            password: password
        },
        function (){
            console.log('SE: Logged in');
            loginSO(callback);
        }
    );
};

var loginSO = function (callback) {
    initLogin(
        'http://stackoverflow.com/users/login',
        'http://stackoverflow.com/users/authenticate',
        {
            openid_identifier: 'https://openid.stackexchange.com'
        },
        function (){
            console.log('SO: Logged in');
            loginChat(callback);
        }
    );
};

var login = function (email, password, callback) {
    loginSEOpenID(email, password, callback);
};



var getSocketURL = function (callback) {
    if (!chatFkey) {
        console.log('Cannot get ws URL without fkey');
        return false;
    }
    request.post({
        url: 'http://chat.stackoverflow.com/ws-auth',
        form: {
            roomid: 1,
            fkey: chatFkey
        }
    }, function (error, response, body) {
        callback(JSON.parse(body).url);
    });
};

var connect = function () {
    getSocketURL(function (url) {
        //two guys walk into a bar. the bartender asks them "is this some kind of joke?"
        bot.adapter.init(chatFkey, 1);// HARDCODE FIXME
        var client = new WebSocketClient();
        client.on('connectFailed', function(error) {
            console.log('Connect Error: ' + error.toString());
        });

        client.on('connect', function(connection) {
            console.log('WebSocket client connected');
            connection.on('error', function(error) {
                console.log("Connection Error: " + error.toString());
            });
            connection.on('close', function() {
                console.log('Connection Closed');
            });
            connection.on('message', function(message) {
                if (message.type === 'utf8') {
                    console.log('Received: ', message.utf8Data);
                    var obj = JSON.parse(message.utf8Data);
                    if (obj.r1 && obj.r1.e) {
                        console.log(obj.r1);
                        bot.parseMessage(obj.r1.e[0]);
                        console.log('DUDE!');
                    }
                }
            });
        });
        console.log(j);
        client.connect(url + '?l=9999999', null, 'http://chat.stackoverflow.com', {'Set-Cookie': j});
        // client.connect('ws://localhost:8080');
    });
};

exports.login = login;
exports.sendMessage = sendMessage;
exports.connect = connect;