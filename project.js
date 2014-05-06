"use strict";

var path = require ('path');
var fs   = require ('fs');
var util = require ('util');

var io     = require ('./io/easy');
var log    = require ('./log');
var common = require ('./common');

// var fsm = StateMachine.create({
//   events: [
//     {name: 'prepare',     from: 'none',         to: 'prepared'},
//     {name: 'instantiate', from: 'prepared',     to: 'instantiated'},
//     {name: 'configure',   from: 'instantiated', to: 'configured'},
// ]});
// alert(fsm.current); // "none"
// fsm.prepare ();
// alert(fsm.current); // "green"

var Project = function (rootPath) {
	this.root = new io (rootPath || process.env.PROJECT_ROOT || process.cwd());

	this.configDir = process.env.PROJECT_CONF || '.dataflows';
	this.varDir    = process.env.PROJECT_VAR  || '.dataflows';

	this.on ('legacy-checked', this.checkConfig.bind(this));
	this.on ('config-checked', this.readInstance.bind(this));
	this.on ('instantiated', this.loadConfig.bind(this));

	this.checkLegacy ();

	// common.waitAll ([
	// 	[this, 'legacy-checked'], // check legacy config
	// 	[this, 'config-checked'], // check current config
	// ], this.readInstance.bind(this));

};

module.exports = Project;

var EventEmitter = require ('events').EventEmitter;

util.inherits (Project, EventEmitter);

Project.prototype.checkLegacy = function (cb) {
	var self = this;
	this.root.fileIO ('etc/project').stat(function (err, stats) {
		if (!err && stats && stats.isFile()) {
			console.error (log.errMsg ('project has legacy configuration layout. you can migrate by running those commands:'));
			console.error ("\n\tcd "+self.root.path);
			console.error ("\tmv etc .dataflows");

			// console.warn ("in", log.dataflows ("@0.60.0"), "we have changed configuration layout. please run", log.path("dataflows doctor"));
			self.configDir = 'etc';
			self.varDir    = 'var';
			self.legacy    = true;
		}
		self.emit ('legacy-checked');
	});
};

Project.prototype.checkConfig = function (cb) {
	var self = this;
	if (self.legacy) {
		self.emit ('config-checked');
		return;
	}

	// search for config root
	var guessedRoot = this.root;
	guessedRoot.findUp (this.configDir, function (foundConfigDir) {
		var detectedRoot = foundConfigDir.parent();
		if (self.root.path !== detectedRoot.path) {
			console.log (log.dataflows (), 'using', log.path (detectedRoot.path), 'as project root');
		}
		self.root = detectedRoot;
		self.emit ('config-checked');
		return true;
	}, function () {
		self.emit ('error', 'no project config');
	});
};


Project.prototype.readInstance = function () {
	var self = this;
	this.instance = process.env.PROJECT_INSTANCE;
	if (this.instance) {
		console.log (log.dataflows(), 'instance is:', log.path (instance));
		self.emit ('instantiated');
		return;
	}
	this.root.fileIO (path.join (this.varDir, 'instance')).readFile (function (err, data) {

		// assume .dataflows dir always correct
		// if (err && self.varDir != '.dataflows') {
			// console.error ("PROBABLY HARMFUL: can't access "+self.varDir+"/instance: "+err);
			// console.warn (log.dataflows(), 'instance not defined');
		// } else {

			var instance = (""+data).split (/\n/)[0];
			self.instance = instance == "undefined" ? null : instance;
			var args = [log.dataflows(), 'instance is:', log.path (instance)];
			if (err) {
				args.push ('(' + log.errMsg (err) + ')');
			} else if (self.legacy) {
				console.error ("\tmv var/instance .dataflows/");
			}
			if (self.legacy) console.log ();
			console.log.apply (console, args);
		// }

		self.emit ('instantiated');
	});
};

Project.prototype.addUnpopulated = function(variable, suggested) {
	if (!this.logUnpopulated.list) {
		this.logUnpopulated.list = {};
	}

	// console.log (variable, suggested);
	this.logUnpopulated.list[variable] = suggested;
}

Project.prototype.logUnpopulated = function() {
	console.error ("those config variables is unpopulated:");
	for (var varPath in this.logUnpopulated.list) {
		var value = this.logUnpopulated.list[varPath];
		console.log ("\t", log.path(varPath), '=', value);
		this.logUnpopulated.list[varPath] = value || "<#undefined>";
	}
	console.error (
		"you can run",
		log.dataflows ("config set <variable> <value>"),
		"to define individual variable\nor edit",
		log.path (".dataflows/"+this.instance+"/fixup"),
		"to define all those vars at once"
	);
	// console.log (this.logUnpopulated.list);
	this.setVariables (this.logUnpopulated.list);
};

Project.prototype.setVariables = function (fixupVars, force) {
	var self = this;
	// ensure fixup is defined
	if (!this.instance) {
		console.log ('Cannot write to the fixup file with undefined instance. Please run', log.dataflows('init'));
		process.kill ();
	}

	if (!self.fixupConfig)
		self.fixupConfig = {};

	// apply patch to fixup config
	Object.keys (fixupVars).forEach (function (varPath) {
		var pathChunks = [];
		var root = self.fixupConfig;
		varPath.split ('.').forEach (function (chunk, index, chunks) {
			pathChunks[index] = chunk;
			var newRoot = root[chunk];
			if (index === chunks.length - 1) {
				if (force || !(chunk in root)) {
					root[chunk] = fixupVars[varPath];
				}
			} else if (!newRoot) {
				root[chunk] = {};
				newRoot = root[chunk];
			}
			root = newRoot;
		});
	});

	// wrote config to the fixup file
	fs.writeFileSync (
		this.fixupFile,
		JSON.stringify (this.fixupConfig, null, "\t")
	);
};

Project.prototype.formats = [{
	type: "json",
	check: /(\/\/\s*json[ \t\n\r]*)?[\{\[]/,
	parser: function (match, configData) {
		try {
			var config = JSON.parse ((""+configData).substr (match[0].length - 1));
			return {object: config};
		} catch (e) {
			return {object: null, error: e};
		}
	}
}];


Project.prototype.parseConfig = function (configData, configFile) {
	var self = this;
	var result;
	this.formats.some (function (format) {
		var match = (""+configData).match (format.check);
		if (match) {
			result = format.parser (match, configData);
			result.type = format.type;
			return true;
		}
	});
	if (!result) {
		var message =
			'Unknown file format in '+(configFile.path || configFile)+'; '
			+ 'for now only JSON supported. You can add new formats using Project.prototype.formats.';
		console.error (log.errMsg (message));
		self.emit ('error', message);
	}
	return result;
}

Project.prototype.interpolateVars = function (error) {
	// var variables = {};
	var self = this;
	var unpopulatedVars = false;

	function iterateNode (node, key, depth) {
		var value = node[key];
		var fullKey = depth.join ('.');
		var match;

		if ('string' !== typeof value)
			return;

		// TODO: techdebt
		// interpolate all inline variables
		// value.interpolate (config, {start: '<', end: '>'});


		var enchanted = self.isEnchantedValue (value);
		if (!enchanted) {
			if (self.variables[fullKey]) {
				self.variables[fullKey][1] = value.toString ? value.toString() : value;
			}

			return;
		}
		if ("placeholder" in enchanted) {
			// this is a placeholder, not filled in fixup
			self.variables[fullKey] = [enchanted.placeholder];
			self.addUnpopulated (fullKey, value);
			unpopulatedVars = true;
			return;
		}
		if ("variable" in enchanted) {
			// this is a variable, we must fill it now
			// current match is a variable path
			// we must write both variable path and a key,
			// containing it to the fixup
			self.variables[fullKey] = [enchanted.variable];
			var varValue = self.getValue (enchanted.variable.substr (1));
			if (!varValue) {
				self.addUnpopulated (fullKey, value);
				self.addUnpopulated (enchanted.variable.substr (1), "");
				unpopulatedVars = true;
			} else {
				node[key] = value.interpolate (self.config, {start: '<', end: '>'});
			}

			return;
		}
		// this cannot happens, but i can use those checks for assertions
		if ("error" in enchanted || "include" in enchanted) {
			throw ("this value must be populated: \"" + value + "\"");
		}
	}

	self.iterateTree (self.config, iterateNode, []);

	// any other error take precendence over unpopulated vars
	if (unpopulatedVars || error) {
		if (unpopulatedVars) {
			self.logUnpopulated();
		}
		self.emit ('error', error || 'unpopulated variables');
		return;
	}

	// console.log ('project ready');

	self.emit ('ready');


}

Project.prototype.loadConfig = function () {

	var self = this;

	var configFile = this.root.fileIO (path.join(this.configDir, 'project'))
	configFile.readFile (function (err, data) {
		if (err) {
			var message = "Can't access "+self.configDir+"/project file. Create one and define project id";
			console.error (log.dataflows(), log.errMsg (message));
			// process.kill ();
			self.emit ('error', message);
			return;
		}

		var config;
		var parsed = self.parseConfig (data, configFile);
		if (parsed.object) {
			config = parsed.object;
		} else {
			var message = 'Project config cannot be parsed:';
			console.error (message, log.errMsg (parsed.error));
			self.emit ('error', message + ' ' + parsed.error.toString());
			process.kill ();
		}

		self.id = config.id;

		// TODO: load includes after fixup is loaded
		self.loadIncludes(config, 'projectRoot', function (err, config, variables, placeholders) {

			self.variables    = variables;
			self.placeholders = placeholders;

			if (err) {
				console.error (err);
				console.warn ("Couldn't load includes.");
				// actually, failure when loading includes is a warning, not an error
				self.interpolateVars();
				return;
			}

			self.config = config;

			if (!self.instance) {
				self.interpolateVars ();
				return;
			}

			self.fixupFile = path.join(self.configDir, self.instance, 'fixup');

			self.root.fileIO (self.fixupFile).readFile (function (err, data) {
				var fixupConfig = {};
				if (err) {
					console.error (
						"Config fixup file unavailable ("+log.path (path.join(self.configDir, self.instance, 'fixup'))+")",
						"Please run", log.dataflows ('init')
					);
				} else {
					var parsedFixup = self.parseConfig (data, self.fixupFile);
					if (parsedFixup.object) {
						self.fixupConfig = fixupConfig = parsedFixup.object;
					} else {
						var message = 'Config fixup cannot be parsed:';
						console.error (message, log.errMsg (parsedFixup.error));
						self.emit ('error', message + ' ' + parsedFixup.error.toString());
						process.kill ();
					}
				}

				util.extend (true, self.config, fixupConfig);

				self.interpolateVars ();

			});
		});
	});
};

function Config () {

}

Config.prototype.getValueByKey = function (key) {
	// TODO: techdebt to remove such dep
	var value = common.getByPath (key, this);
	if (this.isEnchanted (value)) {
		return null;
	}
	return value;
}

Project.prototype.connectors = {};
Project.prototype.connections = {};

Project.prototype.getModule = function (type, name, optional) {
	var self = this;
	optional = optional || false;
	var mod;
	var taskFound = [
		path.join('dataflo.ws', type, name),
		path.resolve(this.root.path, type, name),
		path.resolve(this.root.path, 'node_modules', type, name),
		name
	].some (function (modPath) {
		try {
			mod = require(modPath);
			return true;
		} catch (e) {
			// assuming format: Error: Cannot find module 'csv2array' {"code":"MODULE_NOT_FOUND"}
			if (e.toString().indexOf(name + '\'') > 0 && e.code == "MODULE_NOT_FOUND") {
				return false;
			} else {
				console.error ('requirement failed:', log.errMsg (e.toString()), "in", log.path (self.root.relative (modPath)));
				return true;
			}
		}
	});

	if (!mod && !optional)
		console.error ("module " + type + " " + name + " cannot be used");

	return mod;
};

Project.prototype.getInitiator = function (name) {
	return this.getModule('initiator', name);
};

Project.prototype.getTask = function (name) {
	return this.getModule('task', name);
};

Project.prototype.require = function (name, optional) {
	return this.getModule('', name, optional);
};

var configCache = {};

Project.prototype.iterateTree = function iterateTree (tree, cb, depth) {
	if (null == tree)
		return;

	var level = depth.length;

	var step = function (node, key, tree) {
		depth[level] = key;
		cb (tree, key, depth);
		iterateTree (node, cb, depth.slice (0));
	};

	if (Array === tree.constructor) {
		tree.forEach (step);
	} else if (Object === tree.constructor) {
		Object.keys(tree).forEach(function (key) {
			step (tree[key], key, tree);
		});
	}
};

Project.prototype.getValue = function (key) {
	var value = common.getByPath (key, this.config);
	if (!value)
		return;
	if (this.isEnchantedValue (value))
		return;
	return value;
}

Project.prototype.isEnchantedValue = function (value) {

	var tagRe = /<(([\$\#]*)[^>]+)>/;
	var result;

	if ('string' !== typeof value) {
		return;
	}
	var check = value.match (tagRe);
	if (check) {
		if (check[2] === "$") {
			return {"variable": check[1]};
		} else if (check[2] === "#") {
			return {"placeholder": check[1]};
		} else if (check[0].length === value.length) {
			return {"include": check[1]};
		} else {
			return {"error": true};
		}
	}
}


Project.prototype.loadIncludes = function (config, level, cb) {
	var self = this;

	var DEFAULT_ROOT = this.configDir,
		DELIMITER = ' > ',
		cnt = 0,
		len = 0;

	var levelHash = {};

	var variables = {};
	var placeholders = {};

	level.split(DELIMITER).forEach(function(key) {
		levelHash[key] = true;
	});

	function onLoad() {
		cnt += 1;
		if (cnt >= len) {
			cb(null, config, variables, placeholders);
		}
	}

	function onError(err) {
		console.log('[WARNING] Level:', level, 'is not correct.\nError:', log.errMsg (err));
		cb(err, config, variables, placeholders);
	}

	function iterateNode (node, key, depth) {
		var value = node[key];

		if ('string' !== typeof value)
			return;

		var enchanted = self.isEnchantedValue (value);
		if (!enchanted)
			return;
		if ("variable" in enchanted) {
			variables[depth.join ('.')] = [enchanted.variable];
			return;
		}
		if ("placeholder" in enchanted) {
			placeholders[depth.join ('.')] = [enchanted.placeholder];
			return;
		}
		if ("error" in enchanted) {
			console.error ('bad include tag:', "\"" + value + "\"");
			onError();
			return;
		}
		if ("include" in enchanted) {
			len ++;
			var incPath = enchanted.include;

			if (0 !== incPath.indexOf('/')) {
				incPath = path.join (DEFAULT_ROOT, incPath);
			}

			if (incPath in levelHash) {
				//console.error('\n\n\nError: on level "' + level + '" key "' + key + '" linked to "' + value + '" in node:\n', node);
				throw new Error('circular linking');
			}

			delete node[key];

			if (configCache[incPath]) {

				node[key] = util.clone(configCache[incPath]);
				onLoad();
				return;

			}

			self.root.fileIO(incPath).readFile(function (err, data) {
				if (err) {
					onError(err);
					return;
				}

				self.loadIncludes(JSON.parse(data), path.join(level, DELIMITER, incPath), function(tree, includeConfig) {
					configCache[incPath] = includeConfig;

					node[key] = util.clone(configCache[incPath]);
					onLoad();
				});
			});

		}
	}

	this.iterateTree(config, iterateNode, []);

//	console.log('including:', level, config);

	!len && cb(null, config, variables, placeholders);
};
