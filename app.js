var connection = require('./connection');
var details = require('./loginDetails');

connection.login(details.email, details.password, function (){
	connection.connect();
});
