var d3 = require('d3-request');
var cheapRuler = require('cheap-ruler');
var Conrec = require('./lib/conrec.js');

var turf = {
    polygon: require('@turf/helpers').polygon,
    point: require('@turf/helpers').point,
    featureCollection: require('@turf/helpers').featureCollection,
    inside: require('@turf/inside')
};


function isochrone(startingPosition, parameters, cb){

    //validate
    parameters = validate(startingPosition, parameters, cb);
    if (!parameters) return;

    startingPosition = startingPosition.map(function(coord){
        return parseFloat(coord.toFixed(6))
    })

    var constants = {
        timeIncrement:60,
        queryURL: {
            'divergent': '?sources=0&destinations=all',
            'convergent': '?sources=all&destinations=0'
        },
        startingGrid: 2
    };

    var state = {
        travelTimes: {},
        lngs:{},
        lats:{},
        timeMaximum: typeof parameters.threshold === 'number' ? parameters.threshold : Math.max.apply(null, parameters.threshold)
    }

    state.thresholds = typeof parameters.threshold === 'number' ? listOutIntegers(state.timeMaximum,constants.timeIncrement) : parameters.threshold;
    state.lngs[startingPosition[0]] = 0;
    state.lats[startingPosition[1]] = 0;

    ruler = cheapRuler(startingPosition[1], 'kilometers');

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
            var verticalMovement = 
            ruler.destination(horizontalMovement, yDelta * cellSize, 0)
            .map(function(coord){
                return parseFloat(coord.toFixed(6))
            })

            state.lngs[verticalMovement[0]] = xDelta;
            state.lats[verticalMovement[1]] = yDelta;

            output.push(verticalMovement)
        }

        return output
    }


    function generateBuffer(center, dimensions){

        var centerIndex = [state.lngs[center[0]], state.lats[center[1]]];
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

        var batchSize = parameters.batchSize-1;
        outstandingRequests += Math.ceil(coords.length/batchSize);

        for (var c = 0; c < coords.length; c+=batchSize){
            var batch = coords.slice(c,c+batchSize);
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
                'divergent':{
                    'data': resp.durations[0],
                    'timeObj': 'destinations'
                },
                'convergent':{
                    'data': resp.durations.map(function(item){return item[0]}),
                    'timeObj': 'sources'
                }
            };

            var durations = parseDurations[parameters.direction].data;
            var toBuffer = [];
            var times = resp[parseDurations[parameters.direction].timeObj];
            
            for (var i=1; i<coords.length; i++){

                //calculate distance of grid coordinate from nearest neighbor on road, and assess penalty appropriately
                var snapDistance = ruler.distance(times[i].location, coords[i]);
                var snapPenalty = snapDistance>state.resolution/2 ? state.timeMaximum : snapDistance * 1200;



                // write time to record
                var time = Math.ceil(parameters.fudgeFactor*durations[i]+snapPenalty);
                state.travelTimes[coords[i]] = time;


                if (time < state.timeMaximum) {
                    toBuffer.push(coords[i])
                }
            }

            outstandingRequests--;

            if (toBuffer.length>0) extendBuffer(toBuffer, 12)

            // when all callbacks received
            else if (outstandingRequests === 0) polygonize()
        })
    }


    function polygonize(){

        rawPoints = objectToArray(state.travelTimes, true);

        state.lngs = objectToArray(state.lngs, false).sort(function(a, b){return a-b})
        state.lats = objectToArray(state.lats, false).sort(function(a, b){return a-b}).reverse()

        conrec();

        function conrec(){

            var points =[];

            var twoDArray = [];

            var c = new Conrec.Conrec; 

            for (r in state.lngs){

                var row = [];

                for (d in state.lats){
                    var coord = [state.lngs[r]-0, state.lats[d]];
                    if(!state.travelTimes[coord]) state.travelTimes[coord] = [state.timeMaximum*10];

                    var time = state.travelTimes[coord];

                    points.push(turf.point(coord,{time:time}));

                    row.push(time);
                }
                twoDArray.push(row)

            }      
            postPoints = turf.featureCollection(points);

            // build conrec
            c.contour(twoDArray, 0, state.lngs.length-1, 0, state.lats.length-1, state.lngs, state.lats, state.thresholds.length, state.thresholds);

            var contours = c.contourList()
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

            if (parameters.keepIslands) {
                contours = polygons.map(function(vertices,seconds){
                    return turf.polygon(vertices, {time: seconds});
                }) 
                .filter(function(item){
                    return item !== null
                })
            }

            else {

                contours = polygons.map(function(vertices,seconds){
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

                })
                .filter(function(item){
                    return item !== null
                })
            }


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
            token: {format: 'type', values:['string'], required: true},
            mode: {format: 'among', values:['driving', 'cycling', 'walking'], required:false, default: 'driving'},
            direction: {format: 'among', values:['divergent', 'convergent'], required:false, default: 'divergent'},
            threshold: {format: 'type', values:['number', 'object'], required:true},
            resolution: {format: 'range', min: 0.05, max: 2, required:false, default: 0.5},
            batchSize: {format:'range', min:2, max: Infinity, required:false, default:25},
            fudgeFactor: {format:'range', min:0.5, max: 2, required:false, default: 1},
            keepIslands: {format:'type', values:['boolean'], required:false, default: false}
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
                    if (!parameters.threshold.length || !parameters.threshold.every(function(item){return typeof item === 'number'})){
                        error = ('thresholds must be an array of numbers')            
                    }
                }
            });
        }


        if (error) {
            throw new Error(error)
            return cb(new Error(error))
        }
        else return parameters
    }
}


module.exports = exports = isochrone;
