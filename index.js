var bot = require('./bot.js');
var details = require('./loginDetails.js');

console.log(details);

bot.login(details.email, details.password, function (){
    bot.sendMessage('Test!');
});