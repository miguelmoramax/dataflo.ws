// Require initiator.listener

var events  = require ('events'),
	urlUtil = require ('url'),
	util    = require ('util');


var model = module.exports = function (url) {
	
	var self = this;
	
	if (url.constructor === String) {
		try {
			this.url = urlUtil.parse (url, true);
			var a = this.url.protocol.length;
		} catch (e) {
			self.emit ('error', e);
		}
	} else {
		this.url = url;
	}
	
	this.modelName = this.url.protocol.substr (0, this.url.protocol.length - 1);
	
	// console.log (this.modelName);
	var requiredModel = require ('../model/'+this.modelName);
	this.dataSource = new  requiredModel (this);
	
	// fetch method
	
	this.fetch = function (target) {
		
		self.dataSource.fetch(target);
		
	}
	
	this.store = function (target) {
		
		self.dataSource.store(target);
		
	}
	
	this.stop = function () {
		
		if (self.dataSource.stop) self.dataSource.stop();
		
	}
	
	// this.init();
}

util.inherits (model, events.EventEmitter);

// there are some examples:
// fetch: url (call GET for http, RETR for ftp)
// store: url (call POST for http, PUT for ftp, send email for mailto)