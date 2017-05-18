# isochrone

Isochrone generator built atop the Mapbox Matrix API, with CONREC polygonization. Calculates isochrones up to 1 hour of travel time.


## Setup



## Usage

`isochrone(origin, options, callback)`

- `origin`
Starting point for isochrone generation expressed as `[lng, lat]`.

- `options`

Parameter | Required? | Default | Limits | Description
--- | --- | --- |--- | ---
`token` | Yes | n/a | --- |Mapbox user token
`thresholds` | Yes | n/a | min:1, max: 3600 |Time thresholds for the desired ischrone(s), expressed in seconds. Can be expressed as either a) an array of numbers (e.g. `[600, 1200, 1800]`) to calculate isochrones at those specific time cutoffs, or b) a single number (e.g. `1800`) to calculate isochrones at 60-second intervals, up to that time
`mode` | No | `driving` | one of `driving`, `cycling`, or `walking` | Method of transportation desired.
`direction` | No | `divergent` | `divergent` or `convergent` | Direction of travel. `Divergent` isochrones are the total area reachable _from_ the origin within the given time, while `convergent` ones cover the total area that _can_ reach it. Most isochrones are assumed to be divergent.
`resolution` | No | 0.5 | min:0.05, max: 2 | Granularity of the underlying sample grid, in units of kilometers. Lower values yield finer results, but are more expensive in both query time and API request load. Scaling this value with both time threshold and speed of transport is recommended.
`batchSize` | No | 25 | min: 2 | Number of coordinates per Matrix API request. The default value applies for 


- `callback`


Function to execute once the calculation completes.



## Example
This requests a set of isochrones at 1-minute intervals up to 30 minutes, from near Sacramento, CA:

```javascript
	isochrone([-121.4738,38.6194], {"token":<token>, "threshold":1800}, function(output){
		console.log(output);
	})
```

## Output

Isochrones are returned as a GeoJSON featurecollection of polygon features. Each feature contains a `time` parameter that corresponds to its threshold in seconds.