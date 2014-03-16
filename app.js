var connection = require('./connection.js');
var details = require('./loginDetails.js');


connection.login(details.email, details.password, function (){
	connection.connect();
});