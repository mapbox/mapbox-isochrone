var d3 = require('d3-request');
var cheapRuler = require('cheap-ruler');
var Conrec = require('./lib/conrec.js');

var turf = {
    polygon: require('@turf/helpers').polygon,
    point: require('@turf/helpers').point,
    featureCollection: require('@turf/helpers').featureCollection,
    inside: require('@turf/inside'),
    // union: require('turf-union'),
    // difference: require('turf-difference'),
    // flatten: require('turf-flatten')
};

//water calc
// var cover = require('tile-cover')
// var vt = require('@mapbox/vt2geojson')

function isochrone(startingPosition, parameters, cb){

    // var [x,y,z] = cover.tiles(turf.point(startingPosition).geometry,{min_zoom:8, max_zoom:8})[0]
    // var waterGeometry;
    // vt({
    //     uri: 'https://b.tiles.mapbox.com/v4/mapbox.mapbox-streets-v7/'+ z+'/'+x+'/'+y +'.vector.pbf?access_token='+parameters.token,
    //     layer: 'water'
    // }, function (err, result) {

    //     if (err) throw err;
    //     waterGeometry = turf.flatten(result.features[0])
    //     //console.log(waterGeometry);


    // });

    //validate
    parameters = validate(startingPosition, parameters, cb);
    if (!parameters) return;

    //perf = performance.now();


    var constants = {
        timeIncrement:60,
        queryURL: {
            'divergent': '?sources=0&destinations=all',
            'convergent': '?sources=all&destinations=0'
        },
        startingGrid:2
    };

    var state = {
        travelTimes: {},
        timeHopper: {},
        blacklist: [],
    }

    var timeMaximum = typeof parameters.threshold === 'number' ? parameters.threshold : Math.max.apply(null, parameters.threshold);
    var thresholds = typeof parameters.threshold === 'number' ? listOutIntegers(timeMaximum,constants.timeIncrement) : parameters.threshold;


    ruler = cheapRuler(startingPosition[1], 'miles');

    var lngs = {};
    var lats = {};

    lngs[startingPosition[0]] = 0;
    lats[startingPosition[1]] = 0;

    //track coords to request in each progressive round


    var outstandingRequests = 0;


    // kick off initial batch of queries
    extendBuffer([startingPosition], constants.startingGrid)

    function generateDiagonal(centerOffset, cellSize, dimensions){

        var halfOffset = dimensions * 0.5-1;
        var output = [];


        for (var r = -halfOffset; r <= halfOffset+1; r++){

            var xDelta = centerOffset[0] + r;
            var yDelta = centerOffset[1] + r;

            //first move left/right
            var horizontalMovement = ruler.destination(startingPosition, xDelta * cellSize, 90)

            //then move up/down
            var verticalMovement = ruler.destination(horizontalMovement, yDelta * cellSize, 0)

            lngs[verticalMovement[0]] = xDelta;
            lats[verticalMovement[1]] = yDelta;

            output.push(verticalMovement)
        }
        return output
    }


    function generateBuffer(center, dimensions){

        var centerIndex = [lngs[center[0]], lats[center[1]]];
        var diagonal = generateDiagonal(centerIndex, parameters.resolution*Math.pow(2,0.5), dimensions)
        var grid = [];

        for (var r = 0; r < dimensions; r++){
            for (var c = 0; c<dimensions; c++){
                var lng = diagonal[r][0];
                var lat = diagonal[c][1];
                grid.push([lng, lat]);
            }
        }

        return grid
    }

    // takes the points that need buffering, and buffer them
    function extendBuffer(toBuffer, radius){

        var nextBatch = [];
        var timesSoFar = Object.keys(state.travelTimes).length;

        for (t in toBuffer){

            //generate buffer
            var buffer = generateBuffer(toBuffer[t], radius)
            // dedupe buffer points and drop ones that are already sampled
            buffer.forEach(function(pt){

                if (state.travelTimes[pt] || isNaN(pt[0])) return;
                state.travelTimes[pt] = true;
                nextBatch.push(pt)
            })
        }
        batchRequests(nextBatch)
    }


    // route requests to smaller batches
    function batchRequests(coords){

        outstandingRequests += Math.ceil(coords.length/parameters.batchSize);

        for (var c = 0; c < coords.length; c+=parameters.batchSize){
            var batch = coords.slice(c,c+parameters.batchSize);
            batch.unshift(startingPosition);
            makeRequest(batch)
        }
    }


    // make API call, stows results in state.travelTimes, signals when all callbacks received

    function makeRequest(coords){

        var formattedCoords = coords.map(function(coord, i){
            return [coord[0].toFixed(4), coord[1].toFixed(4)]
        }).join(';')

        var queryURL = 
        'https://api.mapbox.com/directions-matrix/v1/mapbox/'+ parameters.mode +'/' + formattedCoords + constants.queryURL[parameters.direction]+'&access_token=' + parameters.token;

        d3.json(queryURL, function(err, resp){

            var parseDurations = {
                'divergent':resp.durations[0],
                'convergent':resp.durations.map(function(item){return item[0]})
            };

            var durations = parseDurations[parameters.direction];
            var toBuffer = [];

            for (var i=1; i<coords.length; i++){

                var time = durations[i]
                var blacklisted = false;
                // track occurrences of this time
                if (!state.timeHopper[time]) state.timeHopper[time] = [];
                //check to see if this point is actually contiguous with others of the same time
                else {
                    for (s in state.timeHopper[time]){
                        if (ruler.distance(state.timeHopper[time][s], coords[i])<parameters.resolution*1.6){
                            blacklisted = true;
                        }
                    }
                }

                state.timeHopper[time].push(coords[i])

                // write time to record
                time = blacklisted ? [timeMaximum*2] : [time]
                state.travelTimes[coords[i]] = time;


                if (time < timeMaximum) {
                    toBuffer.push(coords[i])
                }
            }

            outstandingRequests--;

            if (toBuffer.length>0) extendBuffer(toBuffer, 10)

            // when all callbacks received
            else if (outstandingRequests === 0) {
                //console.log(toBuffer.length, 'tobuffer')
                polygonize()
            }
        })
    }


    function polygonize(){
        //console.log(performance.now()-perf +' seconds')

        rawPoints = objectToArray(state.travelTimes, true);

        lngs = objectToArray(lngs, false).sort(function(a, b){return a-b})
        lats = objectToArray(lats, false).sort(function(a, b){return a-b}).reverse()

        conrec()

        function conrec(){

            var points =[];

            var twoDArray = [];

            var c = new Conrec.Conrec; 
            for (r in lngs){

                var row = [];

                for (d in lats){
                    var coord = [lngs[r], lats[d]];
                    if(!state.travelTimes[coord]) state.travelTimes[coord] = [timeMaximum*10,timeMaximum*10];
                    var time = state.travelTimes[coord][0];

                    points.push(turf.point(coord,{time:time}));

                    row.push(time);
                }
                twoDArray.push(row)

            }      
            postPoints = turf.featureCollection(points);

            // build conrec
            c.contour(twoDArray, 0, lngs.length-1, 0, lats.length-1, lngs, lats, thresholds.length, thresholds);

            contours = c.contourList()
            polygons = [];

            //iterate through contour hulls
            for (c in contours){

                // get the current level
                var level = contours[c].level;

                //if no level, create it (reserve a first position in array for outer ring)
                if (!polygons[level]) polygons[level] = [];

                // create a shape
                var shape = []
                
                // map x-y to lng,lat array
                for (var k = 0; k<contours[c].length; k++){
                    shape.push([contours[c][k].x, contours[c][k].y])
                }


                //close polygon loop
                shape.push(shape[0]);

                //make sure poly has at least 4 positions
                for (var p = shape.length; p<4; p++){
                    shape.push(shape[0]);
                }
                
                //figure out if shape is an outer ring or an interior cavity, and slot it accordingly 
                if (turf.inside(turf.point(startingPosition), turf.polygon([shape])) === true) {
                    polygons[level][0] = shape;
                }
                else {
                    polygons[level].push(shape)
                }

            }

            contours = polygons.map(function(vertices,seconds){

                if (!vertices.length) {return null;}

                else{

                    //remove all holes that aren't actually holes, but polygons outside the main polygon
                    for (var p = vertices.length-1; p >0; p--){
                        var ring = vertices[p];
                        var r = 0;
                        var soFarInside = true;    
                        while (r < ring.length && soFarInside) {
                            var pointIsInside = turf.inside(turf.point(ring[r]), turf.polygon([vertices[0]]));

                            if (!pointIsInside) soFarInside = false
                            r++
                        }

                        if (!soFarInside) vertices.splice(p,1)

                    }

                    var poly = vertices === null ? null : turf.polygon(vertices, {
                        time: seconds
                    });

                    return poly
                }

            })
            .filter(function(item){
                return item !== null
            })

            hulls = turf.featureCollection(contours)
            travelTimes = state.travelTimes
            cb(hulls)
        }

    }


    function objectToArray(object, arrayOfArrays){

        var keys = Object.keys(object);

        if (!arrayOfArrays) return toNumbers(keys);
        var commaDelimitedNums = keys.map(function(coords){
            var commaDelimited = coords.split(',');
            
            commaDelimited = toNumbers(commaDelimited)
            return commaDelimited
        });

        return commaDelimitedNums
    }

    function toNumbers(strings){
        return strings.map(
            function(string){ 
                return parseFloat(string)
            })
    }

    function listOutIntegers(max, increment){
        var array =[];
        for (var v=increment; v<=max; v+=increment){
            array.push(v)
        }
        return array
    }

    function validate(origin, parameters,cb){

        var validator = {
            token: {format: 'type', values:['string'], required:true},
            mode: {format: 'among', values:['driving', 'cycling', 'walking'], required:false, default: 'driving'},
            direction: {format: 'among', values:['divergent', 'convergent'], required:false, default: 'driving'},
            threshold: {format: 'type', values:['number', 'object'], required:true},
            resolution: {format: 'range', min: 0.05, max: 2, required:false, default: 0.5},
            batchSize:{format:'range', min:2, max: Infinity, required:false, default:25},
            clipCoasts: {format:'type', values:['boolean'], required:false, default: false}
        }

        var error;

        // validate starting position
        if (!origin || typeof origin !=='object' || origin.length!== 2){
            error = 'Starting position must be a longitude-latitude object, expressed as an array.'
        }

        else {
            Object.keys(validator).forEach(function(key){
                var item = validator[key]

                // make sure required parameters are present. if optional, fill in with default value
                if (!parameters[key]) {
                    if(item.required)  error = (key+' required in query')
                    else parameters[key] = item.default
                }

                // ensure parameter is of right type
                else if (item.format === 'type' && item.values.indexOf(typeof parameters[key]) ===-1) {
                    error = (key+' must be a '+ item.values.join(' or '))
                }

                //ensure parameter holds a valid value
                else if (item.format === 'among' && item.values.indexOf(parameters[key]) ===-1) {
                    error = (key+' must be '+ item.values.join(' or '))            
                }

                //ensure parameter falls within accepted range

                else if (item.format === 'range') {
                    if (parameters[key]>item.max || parameters[key]<item.min){
                        error = (key+' must be between '+ item.min+' and '+item.max)            
                    }
                }

                //special parsing for thresholds parameter
                if (typeof parameters.threshold === 'object'){
                    if (!parameters.threshold.length || parameters.threshold.every(function(item){return typeof item === 'number'})){
                        error = ('thresholds must be an array of numbers')            
                    }
                }
            });
        }

        throw new Error(error)
        if (error) return cb(new Error(error))
        else return parameters
    }
}

module.exports = exports = isochrone;