var tape = require('tape');
var _test = require('tape-promise').default;
var test = _test(tape);

var validateGeojson = require('geojson-validation').valid;
var fs = require('fs')
var isochrone = require('../isochrone.js');

var parameters = JSON.parse(fs.readFileSync('fixtures/parameters.json'))

test('can require isochrone', function(assert) {
    // code you would have run manually in the node console to test this
    // what you'd check in the node console -- that you have a function now
    assert.equal(typeof isochrone, 'function', 'got a function by requiring isochrone');
    // ends the test
    assert.end();
});
//
//
// // validation testing
//
test('errors when starting position absent', function(assert){
    return isochrone(null, {})
      .then((data)=>{
      })
      .catch((err)=>{
        assert.ok(err,'starting position error works properly');
        assert.end();
      })
});


test('errors when token is invalid', function(assert){
    return isochrone([0,0], parameters.badToken)
      .then((data)=>{
      })
      .catch((err)=>{
        assert.ok(err, 'token error works properly');
        assert.end();
      })
});


test('errors when threshold is invalid', function(assert){
    isochrone([0,0], parameters.noThreshold)
      .then((data)=>{
      })
      .catch((err)=>{
        assert.ok(err, 'threshold error works properly');
        assert.end();
      })
});


test('returns valid geojson feature collection', function(assert){
  return isochrone([-122.419416, 37.774929], parameters.valid)
    .then((data)=>{
      assert.ok(data, 'data was returned');
      assert.ok(validateGeojson(data), 'data is valid geojson');
      assert.equals(data.type, 'FeatureCollection', 'data is a feature collection');
      assert.end();
    })
    .catch((err)=>{
      throw err;
    })
})
