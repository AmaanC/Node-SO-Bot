var bot = require('./bot.js');
var details = require('./loginDetails.js');


bot.login(details.email, details.password, function (){
    // bot.sendMessage('Test!');
    bot.connect();
});

// bot.connect();