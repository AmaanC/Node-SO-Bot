var req = require('request');
var jsdom = require('jsdom');

var options = {
    jar: true
};

var request = req.defaults(options);

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

var sendMessage = function (text) {
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

var login = function (email, password, callback){
    loginSEOpenID(email, password, callback);
};

exports.login = login;
exports.sendMessage = sendMessage;