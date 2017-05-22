var tape = require('tape');
var fs = require('fs')
var isochrone = require('../isochrone.js');

var parameters = JSON.parse(fs.readFileSync('fixtures/parameters.json'))

tape('can require isochrone', function(assert) {
    // code you would have run manually in the node console to test this
    // what you'd check in the node console -- that you have a function now
    assert.equal(typeof isochrone, 'function', 'got a function by requiring isochrone');
    // ends the test
    assert.end();
});

// validation testing

tape('errors when starting position absent', function(assert){
    isochrone(null, {}, function(err, data){
        console.log(err)
        assert.ok(err, 'starting position error works properly');
        assert.end();
    })
});

tape('errors when token is invalid', function(assert){
    isochrone([0,0], parameters.badToken, function(err, data){
        console.log(err)
	    assert.ok(err, 'token error works properly');
	    assert.end();
    })
});

tape('errors when threshold is invalid', function(assert){
    isochrone([0,0], parameters.noThreshold, function(err, data){
        console.log(err)
        assert.ok(err, 'threshold error works properly');
        assert.end();
    })
});

