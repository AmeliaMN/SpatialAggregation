/*!

spatial.js for interactive http://tinlizzie.org/spatial/ is released under the

MIT License

Copyright (c) 2015-2021 Amelia McNamara and Aran Lunzer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/


        // ************** CHOOSE ONE! *************

        //var dataName = "restaurants";
        var dataName = "earthquakes";

// ------------- parameters for configuring to a given dataset ---------

        // nb: opposite to map zoom, increasing the cell zoom increases cell size.
        // size factor is 2**(zoom level/2).  max cell zoom level is (arbitrarily) 8.
        // the size of cell zoom 0 will be set depending on the initial map zoom.
        var initialMapOffset;
        var requestedCellZoom, effectiveCellZoom, initialCellZoom;
        var minZoom, maxZoom, maxCellZoom=8;
        var landmarkOpacityMinZoom, landmarkOpacityMaxZoom;
        var usePreciseGrid, containerPointsFromLeaflet=false, drawEmptyCells=true, hideCells=false;
        var cellOpacityScale, landmarkOpacityScale, landmarkRadiusScale;

// ------------- web workers -----------

        var workers, workerReplies, workersAwaited;
        var maxWorkers = 8, activeWorkers = 8;          // CONFIGURABLE

// ------------- other shared variables ----------------

		var map, legend, cellCount, canvas;
        var cells, cellsByLocation;
        var gridOrigin, mapRectInContainer, mapContainerSize, mapLatAdjustment;
        var gridToMapMatrix, mapToGridMatrix;
        var gridRotation = 0;
        var gridLngUnit, gridLatUnit;
        var gridRowHeight, gridRowSpacing, gridColumnWidth, gridColumnSpacing;
        var hideMap = false;
        var working = false;
        var workStartTime;

        var baseCell, landmarks, landmarkBounds;
        var cellDensities = [];             // cache of max. estimated densities for each cell zoom level
        var minCellWidth;

        var gridShift = null;   // takes on a latlng value while user is dragging the grid
        var mapShift = null;    // analogue for dragging the map
        var mouseWheelAccumulation = 0;
        var cellCountLocation;

        var cellType = "hexagon";

// ==========================================================

function loadAndPlotData() {
    switch(dataName) {


        // ************************* ADD YOUR DATASET INITIALISATION HERE ******************
        //                     (and be prepared to do some parameter jiggling)

        case "restaurants":

            d3.json("data/restaurants2.json", function(collection){
                features = collection.features;

                // IMPORTANT: add to each landmark a coordinate in our lat/long object format (which Leaflet understands)
                features.forEach(function(d){ d.latlng = latlng(d.geometry.coordinates[1], d.geometry.coordinates[0])});

                initialMapOffset = latlng(34.05, -118.25),

                minZoom = 10, maxZoom = 16, initialZoom = 11,
                initialCellZoom = 4,
                landmarkColour = function(opacity) { return "rgba(200, 0, 250, "+(opacity || 1)+")" }
                landmarkOpacityScale = d3.scale.linear().domain([minZoom, maxZoom]).range([1, 0.3]),
                landmarkRadiusScale = function(z) { return d3.scale.pow().exponent(2).domain([0, maxZoom-minZoom]).range([2, 16])(z-minZoom) };

                buildMap(features);
                });
            break;


        case "earthquakes":

            d3.text("data/2014earthquakes.catalog.txt", function(contents) {
                // this file has space-separated (but aligned) columns, and comment lines that start with #, and empty lines
                var allRows = d3.dsv(" ").parseRows(contents);
                var features = [];
                function nthNonEmpty(fields, n) {
                    var i=0, field=0;
                    do { if (fields[i].length>0) field++; i++ }
                    while (field<n && i<fields.length);
                    return fields[--i];
                }
                var idNum=0;
                allRows.forEach(function (fields) {
                    if (fields[0].length > 0 && fields[0].substring(0,1) !== "#") {
                        var lat = Number(nthNonEmpty(fields, 6)), lng = Number(nthNonEmpty(fields, 7));
                        if (isNaN(lat) || isNaN(lng)) debugger;
                        features.push({ latlng: latlng(lat, lng) });
                    }
                });

                initialMapOffset = latlng(33.45, -117.1),

                minZoom = 6, maxZoom = 13, initialZoom = 8,
                initialCellZoom = 4,
                landmarkColour = function(opacity) { return "rgba(200, 0, 250, "+(opacity || 1)+")" }
                landmarkOpacityScale = d3.scale.linear().domain([minZoom, maxZoom]).range([0.2, 0.7]),
                landmarkRadiusScale = d3.scale.linear().domain([minZoom, maxZoom]).range([1, 3]);

                buildMap(features);
                });
            break;
    }
}

// --------------------------------------------


        function buildMap(features) {
            landmarks = features;

            map = L.map('map', { zoomAnimation: false });

            // updated nov 2021, following guidance at https://stackoverflow.com/questions/64073635/blank-map-tiles-error-410-gone-mapbox-leaflet-js

            /* previous version:
            mapTiles = L.tileLayer('https://{s}.tiles.mapbox.com/v3/ameliamn.k30bdcii/{z}/{x}/{y}.png', {
                attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery � <a href="http://mapbox.com">Mapbox</a>',
                maxZoom: maxZoom, minZoom: minZoom
            }).addTo(map);
            */

            mapTiles = L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
                attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> <strong><a href="https://www.mapbox.com/map-feedback/" target="_blank">Improve this map</a></strong>',
                tileSize: 512, // ??
                maxZoom,
                minZoom,
                zoomOffset: -1, // ??
                id: 'mapbox/streets-v11',
                accessToken: 'pk.eyJ1IjoidGhlbHVueiIsImEiOiJja3c0bDJpcXAwM2c0MzJvOGprbGFvOTB4In0.V6Wwx5xBsnQo42kcZtedTw' // ael token for tinlizzie.org
            }).addTo(map);

            // disable all the map's event handlers
            map.scrollWheelZoom.disable();
            map.boxZoom.disable();
            map.dragging.disable();
            map.keyboard.disable();
            map.touchZoom.disable();
            map.doubleClickZoom.disable();

            // also turn off browser's default scrolling response
            //document.addEventListener('mousewheel', function(evt) { evt.preventDefault() });  nope - we now want scrolling

            map.setView(initialMapOffset, initialZoom);

            var popup = L.popup({closeButton: false})
                .setLatLng(initialMapOffset)
                .setContent('<p><b>Initialising...</b></p>')
                .openOn(map);

            setTimeout(addLandmarksToMap, 100);
        }

        function addLandmarksToMap() {
            map.closePopup();

            startWebWorkers();

            shuffle(landmarks);      // so that when we divide among the workers we should get a uniform spread across the map
            postToAllWorkers({msg: "init", landmarks: landmarks});

            // map._initPathRoot();     // only needed if we were using an svg layer
            var mapElem = d3.select("#map");
            mapContainerSize = map.getSize()
            canvas = mapElem.append("canvas").attr("width", mapContainerSize.x).attr("height", mapContainerSize.y).attr("style", "position:absolute; pointer-events:none");

            var mapBounds = map.getBounds(), lngRange = mapBounds.getEast()-mapBounds.getWest();
            if (lngRange<0) lngRange+=360;
            // define a minimum cell size (corresponding to cell zoom = 0), such that at two zooms (4x) in from the
            // initial display we could fit 40 minimum-sized cells across the map.  just because.
            minCellWidth = lngRange/(40*4);
            var latRange = d3.extent(landmarks, function(l) { return l.latlng.lat });
            var lngRange = d3.extent(landmarks, function(l) { return l.latlng.lng });
            landmarkBounds = [lngRange[0], latRange[0], lngRange[1], latRange[1]];

            estimateLandmarkDensities();
            requestedCellZoom = initialCellZoom;

            gridOrigin = initialMapOffset;
            buildMatrices(gridOrigin.lng, gridOrigin.lat, gridRotation);  // must be updated when gridOrigin or rotation change

            // vars for our event handlers
            var draggingMap = draggingGrid = rotatingGrid = false;
            var initialDragOffset, cumulativeShift;
            var initialMouseAngle, initialRotation;

            map.on("mousedown", function(e) {
                var mouseLatLng = e.latlng;
                if (e.originalEvent.shiftKey) {
                    draggingGrid = true;
                    initialDragOffset = mouseLatLng;
                    cumulativeShift = latlng(0, 0);
                    e.originalEvent.stopPropagation();
                } else if (e.originalEvent.altKey) {
                    rotatingGrid = true;
                    initialMouseAngle = Math.atan2(e.containerPoint.y-mapContainerSize.y/2, e.containerPoint.x-mapContainerSize.x/2)*180/Math.PI;
                    initialRotation = gridRotation;
                    e.originalEvent.stopPropagation();
                } else {
                    draggingMap = true;
                    initialDragOffset = mouseLatLng;
                }
                });

            map.on("mouseup", function() { draggingMap = draggingGrid = rotatingGrid = false; map.dragging.disable() });
            map.on("mousemove", function(e) {
                if (working) return;

                var mapOffset = map.getCenter();
                var mouseLatLng = e.latlng;
                cellCountLocation = mouseLatLng;        // unless told otherwise
                if (draggingGrid) {
                    var desiredOffset = mouseLatLng;
                    var desiredShift = latlng(desiredOffset.lat - initialDragOffset.lat, desiredOffset.lng - initialDragOffset.lng);
                    // communicate to updateMarks the increment through which we want the grid to shift this time
                    gridShift = latlng(desiredShift.lat-cumulativeShift.lat, desiredShift.lng-cumulativeShift.lng);
                    cumulativeShift = desiredShift;
                    updateMarks();
                } else if (rotatingGrid) {
                    var mouseAngle = Math.atan2(e.containerPoint.y-mapContainerSize.y/2, e.containerPoint.x-mapContainerSize.x/2)*180/Math.PI;
                    gridRotation = initialRotation - (mouseAngle-initialMouseAngle);
                    if (Math.abs(gridRotation)>180) gridRotation -= 360*Math.sign(gridRotation);
                    updateMarks();
                } else if (draggingMap) {
                    // figure out the latLng difference between the centre of the map and where the mouse now is, and
                    // hence the latLng the centre should now have such that the current mouse point has the latLng of the
                    // map location where the drag started.  (yes, there's probably a simpler way)
                    var centreLatLng = map.containerPointToLatLng([mapContainerSize.x/2, mapContainerSize.y/2]);
                    var desiredCentre = latlng(initialDragOffset.lat + centreLatLng.lat - mouseLatLng.lat, initialDragOffset.lng + centreLatLng.lng - mouseLatLng.lng);
                    cellCountLocation = initialDragOffset;
                    // because it takes some time to get ready to redraw all the landmarks and grid cells, don't move map until then.
                    // in the mean time, we set mapShift to tell updateMarks how the map is going to be shifting.
                    mapShift = latlng(desiredCentre.lat-mapOffset.lat, desiredCentre.lng-mapOffset.lng);
                    var currentZoom = map.getZoom();
                    updateMarks(function() {
                        map.setView(desiredCentre, currentZoom, { animate: false });
                        });
                } else updateCellCount();

                });

            map.on("zoomend", function() { updateMarks() });            // need intermediate fn to ensure no arg to updateMarks
            map.on("mouseout", function() { cellCount.update(0) });

            // for mouse wheel, we make our own zoom function
            mapElem.on("mousewheel", function () {
                d3.event.preventDefault();
                if (working) return;

                mouseWheelAccumulation += d3.event.wheelDelta;
                if ((Math.abs(mouseWheelAccumulation)) < 120) return;

                var direction = Math.sign(mouseWheelAccumulation);
                mouseWheelAccumulation = 0;
                var mouseLatLng = map.mouseEventToLatLng(d3.event);
                cellCountLocation = mouseLatLng;        // unless told otherwise
                if (d3.event.shiftKey) {
                    requestedCellZoom = Math.min(8, Math.max(0, effectiveCellZoom + direction));
                    console.log("requested zoom (map, grid): ", map.getZoom(), requestedCellZoom);
                    updateMarks();
                } else {
                    var oldZoom = map.getZoom(), newZoom = oldZoom + direction;
                    if (newZoom < minZoom || newZoom > maxZoom) return;

                    requestedCellZoom = effectiveCellZoom;
                    console.log("requested zoom (map, grid): ", newZoom, requestedCellZoom);
                    working = true;
                    map.setZoomAround(mouseLatLng, newZoom, { animate: false });
                }
            });

            mapElem.on("mouseover", function () { this.focus() });

            // a few keyboard controls
            mapElem.on("keydown", function () {
                //console.log(d3.event.keyCode);
                d3.event.preventDefault();

                var keyCode = d3.event.keyCode;
                if (keyCode === 32) { hideMap = !hideMap; updateMarks() }
                if (keyCode === 72 && cellType !== "hexagon") { cellType = "hexagon"; estimateLandmarkDensities(); updateMarks() }
                if (keyCode === 83 && cellType !== "square") { cellType = "square"; estimateLandmarkDensities(); updateMarks() }
                if (false && keyCode >= 48 && keyCode <= 48 + maxWorkers) {  // DISABLED - just stick with the default 8
                    activeWorkers = keyCode - 48;
                    console.log(activeWorkers ? "switching to " + activeWorkers + " web workers" : "switching off use of web workers");
                    updateMarks();
                }
                if (keyCode === 69) { drawEmptyCells = !drawEmptyCells; updateMarks() }
                if (keyCode === 27) { if (!hideCells) { hideCells = true; updateMarks() } }

                // secret codes (use shift)
                if (false && keyCode === 67 && d3.event.shiftKey) { // DISABLED
                    containerPointsFromLeaflet = !containerPointsFromLeaflet;
                    console.log(containerPointsFromLeaflet ? "leaflet" : "approx");
                    updateMarks();
                }
            });
            mapElem.on("keyup", function() {
                var keyCode = d3.event.keyCode;
                if (keyCode===27) { hideCells = false; updateMarks() }
            })

            // a simple colour legend
            legend = L.control({position: 'bottomright'});
            legend.onAdd = function (map) {
                this._div = L.DomUtil.create('div', 'info legend');
                return this._div;
            };
            // in the legend show up to 9 opacity levels, corresponding to "nice" numbers
            legend.update = function(cellZoom) {
                // not elegant, but it kinda works.
                // we want a scale of nice numbers (10, 20, 50 and their ilk) that more or less cover the range of the populations
                // per cell at the current cell zoom.
                // because opacity differences near 1 are harder to see than those near zero, we pick a bunch of opacities
                // that are closely spaced at bottom and further apart at top.
                function niceNum(n) {
                    var mults = [1, 2, 5];
                    var tens = Math.floor(Math.log10(n));
                    var rMin = 9999, bestN;
                    [tens, tens+1].forEach(function(e) {
                        mults.forEach(function(m) {
                            var candidate = Math.round(Math.pow(10, e)*m);
                            var ratio = n/candidate;
                            if (ratio<1) ratio=1/ratio;
                            if (ratio<rMin) { rMin = ratio; bestN = candidate }
                        })
                    })
                    return bestN;
                }

                // display cell width in a nice way
                var cellW = minCellWidth*Math.pow(2, cellZoom/2);
                var cellWkm = L.latLng(gridOrigin).distanceTo(transformCoord(cellW, 0, gridToMapMatrix))/1000;
                var tens = Math.floor(Math.log10(cellWkm)), tensFactor = Math.pow(10, tens-1);
                var cellWTwoSigs = Math.round(cellWkm/tensFactor)*tensFactor;
                var cellWString = cellWTwoSigs.toFixed(Math.max(1-tens, 0));

                var html = '<div style="text-align:center; margin-bottom:4px"><b>cell size '+cellZoom+'</b><br>(~'+cellWString+'km)</div>';
                var niceCounts = [];
                // create opacity values with the right kind of spacing, then convert to "nice" landmark-count numbers,
                // removing duplicates.
                for (var i=9; i>=1; i--) {    // downwards, to ensure the highest one is included (even if next down is a duplicate)
                    var usefulOpacity=Math.exp(Math.log(0.11)*(1-i/9));  // log provides appropriate spacing
                    var niceCount = niceNum(cellOpacityScale.invert(usefulOpacity));
                    if (!(cellOpacityScale(niceCount)>1.1 || (niceCounts.length>0 && niceCounts[0] === niceCount))) niceCounts.unshift(niceCount);
                }
                niceCounts.forEach(function(count) {
                    html +=
                        '<i style="background:' + 'rgba(0, 0, 255, '+cellOpacityScale(count)+'"></i> ' + count +
                        (i===9 ? '' : '<br>');
                });
                this._div.innerHTML = html;
            }
            legend.addTo(map);

            // a counter that tracks mouse hover
            cellCount = L.control({position: 'topright'});
            cellCount.onAdd = function (map) {
                this._div = L.DomUtil.create('div', 'count');
                this.update(0);
                return this._div;
            };
            cellCount.update = function(count) {
                var numString = String(count);
                for (var i=numString.length; i<5; i++) numString = "&nbsp;"+numString;
                this._div.innerHTML = "<b>count:"+numString+"</b>";
            }
            cellCount.addTo(map);

            // final preparation: focus the map
            //document.getElementById("map").focus();

            // and draw!!
            updateMarks();
        }

        // shuffle from http://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
        function shuffle(array) {
          var currentIndex = array.length, temporaryValue, randomIndex ;

          // While there remain elements to shuffle...
          while (0 !== currentIndex) {

            // Pick a remaining element...
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;

            // And swap it with the current element.
            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
          }

          return array;
        }

        function estimateLandmarkDensities() {
            // estimate the landmarks-per-cell density for each cell zoom level.
            // to keep the number of cells within reason, start by using the coarsest cells then for subsequent
            // measurements only use the region of what turned out to be the most populated of those cells.
            var mapRect = landmarkBounds;
            var dataPoints = [];
            var oldPrecise = usePreciseGrid;
            usePreciseGrid = true;
            for (var cz=maxCellZoom; cz>=0; cz--) {
                var gridCentre = latlng((mapRect[1]+mapRect[3])/2, (mapRect[0]+mapRect[2])/2);
                buildMatrices(gridCentre.lng, gridCentre.lat, 0);
                buildCells(cellType, cz, mapRect, gridCentre);  // sets up cells and cellsByLocation
                var maxC = 0;
                countLandmarks(mapRect);
                cells.forEach(function(cell) {
                    var c = cell.landmarkCount;
                    if (c>maxC) {
                        maxC=c;
                        if (cz===maxCellZoom) {
                            // first time through, record a region centred on whichever cell is most populous
                            var e = 2;  // slight expansion over the cell we found.  don't go nuts.
                            var centroidLL = locLL(cell.centroid);
                            var latDiffs = d3.extent(cell.vertices, function(pRef) { return locLL(pRef).lat-centroidLL.lat });
                            var lngDiffs = d3.extent(cell.vertices, function(pRef) { return locLL(pRef).lng-centroidLL.lng });
                            mapRect = [ centroidLL.lng+lngDiffs[0]*e, centroidLL.lat+latDiffs[0]*e, centroidLL.lng+lngDiffs[1]*e, centroidLL.lat+latDiffs[1]*e ];
                        }
                    }
                    });
                // console.log("cell zoom "+cz+": "+maxC+" max in "+cells.length+" cells");
                dataPoints.push([cz, maxC/Math.pow(2, cz/2)]);
            }

            // use linear regression to figure out a typical density (landmarks per unit area), and store these for each cell zoom
            var lin = linearRegressionLine(linearRegression(dataPoints));
            for (var cz=maxCellZoom; cz>=0; cz--) {
                var estimate = Math.round(lin(cz)*Math.pow(2, cz/2));
                cellDensities[cz] = estimate;
            }
            usePreciseGrid = oldPrecise;
        }

        function updateMarks(whenReadyToDrawFn) {
            working = true;
            workStartTime = Date.now();

            mapTiles.setOpacity(hideMap ? 0.1 : 1);
            var mapOffset = map.getCenter();
            var mapBounds = map.getBounds();
            var viewRect = boundsToRectArray(mapBounds);
            // if the map is going to be shifted prior to redraw, take account here of that shift
            if (mapShift) {
                mapOffset = latlng(mapOffset.lat+mapShift.lat, mapOffset.lng+mapShift.lng);
                viewRect[0] += mapShift.lng;
                viewRect[1] += mapShift.lat;
                viewRect[2] += mapShift.lng;
                viewRect[3] += mapShift.lat;
                mapShift = null;
            }

            // the grid centroid is by definition the centroid of the central grid cell.
            // to avoid cell distortion if the user scrolls the map far from its original centre, or similarly does
            // an extended drag on the grid, we re-centre the grid on every redraw.
            //
            // if the grid is shifting relative to the map:
            //   calculate the position of a phantom map-centre moving in the opposite direction
            //   find the grid cell containing the phantom centre
            //   the difference between the centre and that cell's centroid tells us where the new grid centroid must be
            //     (relative to the real map centre)
            //
            // if the whole map is shifting (with the grid):
            //   find the grid cell containing the position of the new map centre
            //   again, the difference between the map centre and that cell's centroid is what we need.
            //
            // in other words, the only difference between the two cases is what pseudo-map-centre we search for in the grid.
            var testMapCentre = gridShift ? latlng(mapOffset.lat-gridShift.lat, mapOffset.lng-gridShift.lng) : mapOffset;
            gridShift = null;  // make sure we reset it
            var centreCell = findCell(testMapCentre);  // note: in extreme zoom cases it might not be found
            if (centreCell) {
                var centroidLL = locLL(centreCell.centroid);
                var centroidDiff = latlng(centroidLL.lat-testMapCentre.lat, centroidLL.lng-testMapCentre.lng);
                gridOrigin = latlng(mapOffset.lat+centroidDiff.lat, mapOffset.lng+centroidDiff.lng);
            } else {
                // somehow failed; maybe it's the first time through
                gridOrigin = mapOffset;
                if (cells.length>0) console.log("*** centre not found");
            }

            // now that we've decided the map centre and grid origin, rebuild the transformation matrices
            buildMatrices(gridOrigin.lng, gridOrigin.lat, gridRotation);

            // boost cell zoom if needed to ensure we have no more than 200 across the screen
            var lngRange = viewRect[2]-viewRect[0];
            if (lngRange<0) lngRange += 360;
            var minUsefulZoomFactor = lngRange/200/minCellWidth;
            effectiveCellZoom = requestedCellZoom;
            while (Math.pow(2, effectiveCellZoom/2)<minUsefulZoomFactor) { effectiveCellZoom += 1 };
            if (effectiveCellZoom!==requestedCellZoom) console.log("cell zoom boosted to "+effectiveCellZoom);

            // set the opacity scale such that at the sampled maximum the opacity is 0.9
            var sampledMax = cellDensities[effectiveCellZoom];
            cellOpacityScale = d3.scale.sqrt().domain([0, sampledMax]).range([0, 0.9]);
            legend.update(effectiveCellZoom);

            // switch to precise mode if there are likely to be fewer than 100 cells across the screen
            var estimatedCellsAcross = lngRange/(minCellWidth*Math.pow(2, effectiveCellZoom/2));
            var bePrecise = estimatedCellsAcross<100;
            if (bePrecise !== usePreciseGrid) {
                usePreciseGrid = bePrecise;
                //console.log("Precision: "+ (bePrecise ? "ON" : "OFF"))
            }

            // and now build the cells!
            buildCells(cellType, effectiveCellZoom, viewRect, gridOrigin);
            //console.log(cells.length+" cells");
            //cells[0].highlight = true;

            // if the cells are big, add an allowance to the viewRect to ensure we count landmarks that
            // are in a cell even if they're out of view
            var landmarkRect = viewRect.slice();
            if (usePreciseGrid) {
                var lngMargin = gridLngUnit * gridColumnWidth, latMargin = gridLatUnit * gridRowHeight;
                landmarkRect[0] -= lngMargin;
                landmarkRect[1] -= latMargin;
                landmarkRect[2] += lngMargin;
                landmarkRect[3] += latMargin;
            }

            workersAwaited = [];
            var totalWorkers = activeWorkers;    // or add one for this thread
            var landmarksPerWorker = Math.floor(landmarks.length/totalWorkers);

            var parms={ cellType: cellType, mapToGridMatrix: mapToGridMatrix, gridLatUnit: gridLatUnit, gridLngUnit: gridLngUnit, gridColumnSpacing: gridColumnSpacing, gridColumnWidth: gridColumnWidth, gridRowSpacing: gridRowSpacing, gridRowHeight: gridRowHeight };
            for (var wi=0; wi<activeWorkers; wi++) {
                var start = wi*landmarksPerWorker;
                var end = (wi === totalWorkers-1) ? landmarks.length : start+landmarksPerWorker;
                workers[wi].postMessage({msg: "compute", parms: parms, landmarkRange: [ start, end ], viewRect: landmarkRect });
                workersAwaited.push(wi);
            }

            // do the landmark counting on this thread if no workers
            if (activeWorkers===0) countLandmarks(landmarkRect);

            var whenReady = function() {
                if (whenReadyToDrawFn) whenReadyToDrawFn();
                drawMarks(viewRect);
                updateCellCount();

                if (false) {  // diagnostic info on update time
                    console.log(Date.now()-workStartTime+"ms");
                }
            }

            waitForWorkers();

            function waitForWorkers() {
                if (workersAwaited.length===0) whenReady();
                else setTimeout(waitForWorkers, 1);
            }
        }


        function drawMarks(viewRect) {
            var zoom = map.getZoom();
            recordMapBounds(map.getBounds());   // now that the map has settled.  used for calculating container points.

            var ctx = canvas.node().getContext("2d");
            ctx.clearRect(0, 0, canvas.node().width, canvas.node().height);

            // draw all the landmarks that are visible
            var op = hideMap ? 0 : landmarkOpacityScale(zoom);
            if (op>0) {
                ctx.fillStyle = landmarkColour(op);
                var radius = landmarkRadiusScale(zoom), useRect = radius < 3;
                landmarks.forEach(function(landmark) {
                    var ll = landmark.latlng;
                    if (pointWithinRect(ll.lng, ll.lat, viewRect)) {
                    // TESTING.  we expect y anomaly <= 1 pixel.
                    // var anomaly = checkPointAnomaly(ll).y;
                    // if (anomaly>0) console.log(anomaly);
                        var xy = latLngToContainerPoint(landmark.latlng);
                        if (useRect) { ctx.fillRect(xy.x-radius, xy.y-radius, radius*2, radius*2) }
                        else {
                            ctx.beginPath();
                            ctx.arc(xy.x, xy.y, radius, 0, 2*Math.PI);
                            ctx.fill();
                        }
                    }
                    });
            }

            // then draw and shade the grid - unless user is holding Escape key
            if (!hideCells) {
                ctx.strokeStyle = "#BBB";
                ctx.lineWidth = 0.5;
                for (var ci=0; ci<cells.length; ci++) {
                    var cell = cells[ci];
                    var landmarkCount = cell.landmarkCount;
                    if ((drawEmptyCells ? !(hideMap && landmarkCount===0) : landmarkCount>0) || cell.highlight) {
                        var vertices = cellContainerVertices(cell);
                        ctx.beginPath();
                        ctx.moveTo(vertices[0].x, vertices[0].y);
                        for (var i=1; i<vertices.length; i++) { var v=vertices[i]; ctx.lineTo(v.x, v.y) };
                        ctx.closePath();
                        if (!hideMap) ctx.stroke();
                        if (landmarkCount>0) {
                            ctx.fillStyle = cell.highlight ? "#FF0" : "rgba(0, 0, 255, "+Math.min(1, cellOpacityScale(landmarkCount))+")";
                            ctx.fill();
                        }
                    }
                }
            }

            if (traceLocs) console.log("locs used: "+(locs.length-1), "maxX: "+maxLocX, "maxY: "+maxLocY);

            working = false;
        }

        function updateCellCount() {
            // update landmark count for the latLng location saved in cellCountLocation
            var cell = findCell(cellCountLocation || gridOrigin);
            if (cell) { cellCount.update(cell.landmarkCount) }
        }

        function countLandmarks(rect) {
            landmarks.forEach(function(landmark) {
                var ll = landmark.latlng;
                if (pointWithinRect(ll.lng, ll.lat, rect)) {
                    var cell = findCell(landmark.latlng);
                    if (cell) cell.landmarkCount++
                }
            })
        }

        function storeCell(cell) {
            cells.push(cell);
            var key = cell.row*1024+cell.col;
            cellsByLocation[key] = cell;
        }

        function findCell(loc) { return lookupCell(findCellRowCol(loc)) };

        function lookupCell(rowCol) {
            var key = rowCol.row*1024+rowCol.col;
            return lookupCellKey(key);
        }

        function lookupCellKey(key) {
            var cell = cellsByLocation[key];
            return cell ? cell : null;
        }

        function findCellRowCol(loc) {
            var gridLatLng = transformCoord(loc.lng, loc.lat, mapToGridMatrix);
            // ranks can overlap.
            // for rows and columns we therefore have both the rank size (e.g., column width) and spacing.
            // for example, for hexagons the column width is 4 and spacing 3.
            // divide x by the spacing (3).  use integer part to find dist to closest centre below x, and to next one.
            // if either diff is less than width/2, it's a matching rank.
            //      input: 6 => centres 6 (rank 2), 9; diffs 0, 3 (cf width 4) => only in rank 2
            //      input: 7.5 => centres 6, 9; diffs 1.5, 1.5 => in ranks 2 and 3
            //      input: 1.2 => centres 0, 3; diffs 1.2, 1.7 => in ranks 0 and 1
            // if two feasible row/column pairs are found, we check the position wrt the line joining the cells' centroids.
            var unitLng = gridLatLng.lng/gridLngUnit;
            var signLng = Math.sign(gridLatLng.lng) || 1;     // use positive quadrant if exactly on zero
            var lngMultiple = (unitLng/gridColumnSpacing)|0;  // yeah.  truncates towards zero, because | requires an integer.
            var colCands = [];
            [ lngMultiple, lngMultiple+signLng ].forEach(function(centre) {
                    if (Math.abs(centre*gridColumnSpacing-unitLng)/gridColumnWidth <= 0.5) colCands.push(centre);
                    });
            var unitLat = gridLatLng.lat/gridLatUnit;
            var signLat = Math.sign(gridLatLng.lat) || 0;
            var latMultiple = (unitLat/gridRowSpacing)|0;
            var pairCands = [];
            [ latMultiple, latMultiple+signLat ].forEach(function(centre) {
                    if (Math.abs(centre*gridRowSpacing-unitLat)/gridRowHeight <= 0.5) {
                        colCands.forEach(function(col) {
                            // for hexagons, only row/col pairs separated by an even number are valid.  because that's how we make 'em.
                            if (!(cellType==="hexagon" && (Math.abs(centre-col)%2))) {
                                pairCands.push({ row: centre, col: col });
                            }
                            })
                        }
                    });

            var bestMatch = pairCands[0];

            if (pairCands.length>1) {
                // figure out which centroid the point is nearest.
                // we have to do this comparison in degree units, because with hexagons a vertical unit is bigger than a horizontal.
                // this means that finely-balanced splits in the far north or south will sometimes go the wrong way.  boo hoo.
                var centroidSqDists = pairCands.map(function(rc) {
                    var lngDiff = rc.col*gridColumnSpacing*gridLngUnit-gridLatLng.lng;
                    var latDiff = rc.row*gridRowSpacing*gridLatUnit-gridLatLng.lat;
                    return lngDiff*lngDiff + latDiff*latDiff;
                    });
                if (centroidSqDists[1]<centroidSqDists[0]) bestMatch = pairCands[1];

                // a couple of useful points near Oceanside (in the earthquake data) for debugging.
                //if (!counting && Math.abs(loc.lng+117.17)<0.02 && Math.abs(loc.lat-33.22)<0.02) console.log(pairCands[0], bestMatch);
            }

            return { row: bestMatch.row, col: bestMatch.col };
        }

        function matrixMultiply(a, b) {
            var size=a.length;
            var newM = [];
            for (var r=0; r<size; r++) {
                var aRow = a[r];
                var row = [];
                newM.push(row);
                for (var c=0; c<size; c++) {
                    // multiply a's row by b's column
                    var sum=0;
                    for (var i=0; i<size; i++) sum+=aRow[i]*b[i][c];
                    row.push(sum);
                }
            }
            return newM;
        };

        function matrixTranspose(m) {
            var size=m.length;
            var newM = [];
            for (var r=0; r<size; r++) {
                var row = [];
                for (var c=0; c<size; c++) row.push(m[c][r]);
                newM.push(row);
            }
            return newM;
        };

        function vectorMultiply(m, v) {
            var size=v.length;
            var newV = [];
            for (var r=0; r<size; r++) {
                // multiply m's row by v
                var row=m[r];
                var sum=0;
                for (var c=0; c<size; c++) {
                    sum+=row[c]*v[c]
                }
                newV.push(sum);
            }
            return newV;
        };

        function buildMatrices(originLng, originLat, rotation) {
            var conv = Math.PI/180;
            var lngRad = originLng*conv, latRad = originLat*conv, rotRad = rotation*conv;
            var sinA = Math.sin(lngRad), cosA = Math.cos(lngRad);
            var sinB = Math.sin(latRad), cosB = Math.cos(latRad), cosBdiff=1-cosB;
            var sinG = Math.sin(rotRad), cosG = Math.cos(rotRad), cosGdiff=1-cosG;

            // rotation by originLng around z axis
            var matA = [
                [cosA, -sinA, 0],
                [sinA, cosA, 0],
                [0, 0, 1]
                ];
            // rotation by originLat about rotated x axis
            var matB = [
                [cosB + cosA*cosA*cosBdiff, sinA*cosA*cosBdiff, -sinA*sinB],
                [sinA*cosA*cosBdiff, cosB+sinA*sinA*cosBdiff, cosA*sinB],
                [sinA*sinB, -cosA*sinB, cosB]
                ];
            // rotation about the normal at originLng, originLat
            var matG = [
                [cosG + sinA*sinA*cosB*cosB*cosGdiff, -sinA*cosA*cosB*cosB*cosGdiff - sinB*sinG, sinA*sinB*cosB*cosGdiff-cosA*cosB*sinG],
                [-sinA*cosA*cosB*cosB*cosGdiff + sinB*sinG, cosG + cosA*cosA*cosB*cosB*cosGdiff, -cosA*sinB*cosB*cosGdiff - sinA*cosB*sinG],
                [sinA*sinB*cosB*cosGdiff + cosA*cosB*sinG, -cosA*sinB*cosB*cosGdiff + sinA*cosB*sinG, cosG + sinB*sinB*cosGdiff]
                ];

            var matBA = matrixMultiply(matB, matA);
            gridToMapMatrix = matrixMultiply(matG, matBA);
            mapToGridMatrix = matrixTranspose(gridToMapMatrix);
        }

        function transformCoord(lng, lat, matrix) {
            var conv = Math.PI/180;
            var lngRad = lng*conv, latRad = lat*conv;
            var sinTx = Math.sin(lngRad), cosTx = Math.cos(lngRad);
            var sinTy = Math.sin(latRad), cosTy = Math.cos(latRad);

            var newV = vectorMultiply(matrix, [sinTx*cosTy, -cosTx*cosTy, sinTy]);

            var newLat = Math.asin(newV[2])/conv;
            var newLng = Math.atan2(newV[1], newV[0])/conv + 90;
            if (Math.abs(newLng)>180) newLng -= 360*Math.sign(newLng);

            return { lat: newLat, lng: newLng }
        }

        function buildCells(type, cellZoom, mapRect, gridCentre) {
            var unitLength;
            var cellWidth = minCellWidth*Math.pow(2, cellZoom/2);
            var vertexOffsets, centroidOffsets;

            cells = [];
            cellsByLocation = {};

            switch(type) {
                case "square":
                    unitLength = cellWidth/2;
                    gridLngUnit = unitLength; gridLatUnit = unitLength;
                    gridColumnWidth = gridColumnSpacing = 2;
                    gridRowHeight = gridRowSpacing = 2;
                    vertexOffsets = [ pt(-1, 1), pt(1,1), pt(1, -1), pt(-1, -1) ];
                    centroidOffsets = [  // each pair is <grid-unit diff> <row/col diff>
                        [ pt(0, 2), pt(1, 0) ],
                        [ pt(2, 0), pt(0, 1) ],
                        [ pt(0, -2), pt(-1, 0) ],
                        [ pt(-2, 0), pt(0, -1) ]
                        ];
                    break;
                case "hexagon":
                    unitLength = cellWidth/4;
                    gridLngUnit = unitLength; gridLatUnit = unitLength*Math.sqrt(3);
                    gridColumnWidth = 4; gridColumnSpacing = 3;
                    gridRowHeight = 2; gridRowSpacing = 1;
                    vertexOffsets = [ pt(-1, 1), pt(1,1), pt(2, 0), pt(1, -1), pt(-1, -1), pt(-2, 0) ];
                    centroidOffsets = [
                        [ pt(0, 2), pt(2, 0) ],
                        [ pt(3, 1), pt(1, 1) ],
                        [ pt(3, -1), pt(-1, 1) ],
                        [ pt(0, -2), pt(-2, 0) ],
                        [ pt(-3, -1), pt(-1, -1) ],
                        [ pt(-3, 1), pt(1, -1) ]
                        ];
                    break;
            }

            function buildPoly(centroidRef, recordVertices) {
                var poly = { centroid: centroidRef, landmarkCount: 0 };
                loc(centroidRef);           // ensure that the point object exists (used to check for already-built cells)
                if (usePreciseGrid || recordVertices) {
                    var xy = locXY(centroidRef);
                    poly.vertices = vertexOffsets.map(function(p) { return locRef(p.x+xy.x, p.y+xy.y) });
                }
                return poly;
            }

            // procedure:
            //   create central polygon.  add to polygons list, and its centroid coord as sole entry in "seeds" queue.
            //   repeat until seeds list is empty
            //     remove first seed from list
            //     for each of seed's growing directions (e.g., six for a hexagon)
            //       if no (centroid) point in the specified direction
            //         add a polygon with this centroid to the polygons list
            //         iff new polygon's centroid is within map bounds, add centroid to the seed list

            initLocList();
            var seeds = [];

            var o = locRef(0, 0);
            baseCell = buildPoly(o, true);  // always record the vertices for the base cell
            baseCell.row = baseCell.col = 0;
            storeCell(baseCell);    // now it knows its row and col
            seeds.push(baseCell);

            while (seeds.length>0) {
                var seedCell = seeds.shift(), centroidRef = seedCell.centroid;
                var centroidXY = locXY(centroidRef);
                centroidOffsets.forEach(function(offsetPair) {
                    var newX = centroidXY.x + offsetPair[0].x, newY = centroidXY.y + offsetPair[0].y;
                    var newCentroidRef = locRef(newX, newY);
                    if (!locExists(newCentroidRef)) {  // if the point exists, there's already a cell with it as centroid
                        var cell = buildPoly(newCentroidRef);
                        cell.row = seedCell.row + offsetPair[1].x;
                        cell.col = seedCell.col + offsetPair[1].y;
                        storeCell(cell);
                        var ll = locLL(newCentroidRef);
                        if (pointWithinRect(ll.lng, ll.lat, mapRect)) seeds.push(cell);
                    }
                    })
            }
        }


        // from https://github.com/simple-statistics/simple-statistics/blob/master/src/linear_regression.js
        function linearRegression(data) {
            var m, b;
            // Store data length in a local variable to reduce
            // repeated object property lookups
            var dataLength = data.length;
            //if there's only one point, arbitrarily choose a slope of 0
            //and a y-intercept of whatever the y of the initial point is
            if (dataLength === 1) {
                m = 0;
                b = data[0][1];
            } else {
                // Initialize our sums and scope the `m` and `b`
                // variables that define the line.
                var sumX = 0, sumY = 0,
                    sumXX = 0, sumXY = 0;

                // Use local variables to grab point values
                // with minimal object property lookups
                var point, x, y;

                // Gather the sum of all x values, the sum of all
                // y values, and the sum of x^2 and (x*y) for each
                // value.
                //
                // In math notation, these would be SS_x, SS_y, SS_xx, and SS_xy
                for (var i = 0; i < dataLength; i++) {
                    point = data[i];
                    x = point[0];
                    y = point[1];

                    sumX += x;
                    sumY += y;

                    sumXX += x * x;
                    sumXY += x * y;
                }

                // `m` is the slope of the regression line
                m = ((dataLength * sumXY) - (sumX * sumY)) /
                    ((dataLength * sumXX) - (sumX * sumX));

                // `b` is the y-intercept of the line.
                b = (sumY / dataLength) - ((m * sumX) / dataLength);
            }

            // Return both values as an object.
            return {
                m: m,
                b: b
            };
        }

        // similarly, from https://github.com/simple-statistics/simple-statistics/blob/master/src/linear_regression_line.js
        function linearRegressionLine(mb) {
            // Return a function that computes a `y` value for each
            // x value it is given, based on the values of `b` and `a`
            // that we just computed.
            return function(x) {
                return mb.b + (mb.m * x);
            };
        }

// ---------- handling of grid locations ----------

        // in the grid, all points (centroids, vertices) are stored as locRefs, which are pointers into a locList based on their
        // x and y coords (base-grid signed integer longitude and latitude units, respectively).
        // the locs themselves are generated lazily, when someone asks for information about the loc (e.g., its latlng).
        // when generated, the loc is added to the locs collection, and its index in that collection stored in locList.
        // clients deal only in locRefs, and never see the indices.

        var maxCoord = 1000;  // x&y coords from -1000 to +1000, i.e. about 1000 square grid cells in each direction.
        var locListBuffer, locList, locs;

        var traceLocs=false;        // whether to provide diagnostic info on the locs mechanism
        var maxLocX, maxLocY;

        function initLocList() {
            locListBuffer = new ArrayBuffer((maxCoord*2+1)*(maxCoord*2+1)*4); // room for a 32-bit int for x/y from -maxCoord to +maxCoord
            locList = new Uint32Array(locListBuffer);
            locs = [null];                              // we use zero in locList to mean loc hasn't been created yet

            if (traceLocs) maxLocX = maxLocY = 0;
        }
        function loc(locRef) {
            // someone actually wants the loc object.  generate it if it didn't exist.
            var locIndex = locList[locRef];
            if (locIndex) return locs[locIndex];

            locList[locRef] = locs.length;
            var newLoc = privateMakeLoc(locRef);
            locs.push(newLoc);
            return newLoc;
        }
        function locExists(locRef) { return locList[locRef] !== 0 }  // only true once someone has asked for info about the loc
        function locContainerPt(locRef) { var l = loc(locRef); return l.containerPt || (l.containerPt = latLngToContainerPoint(l.latlng)) }
        function locLL(locRef) { return loc(locRef).latlng }
        function locRef(x, y) {
            if (traceLocs) { maxLocX = Math.max(maxLocX, x); maxLocY = Math.max(maxLocY, y) }
            var xMult = maxCoord*2+1;  // NB: must be same as in locXY()!
            var ref = (x+maxCoord)*xMult + y+maxCoord;
            if (ref<0 || ref>locList.length) console.log("FATAL: out-of-bounds location requested ("+x+", "+y+")");
            return ref;
        }
        function locXY(locRef) {
            var xMult = maxCoord*2+1;
            var yRaw = locRef % xMult, xRaw = (locRef-yRaw)/xMult;
            return pt(xRaw-maxCoord, yRaw-maxCoord);
        }
        function privateMakeLoc(locRef) {
            var xy = locXY(locRef);
            return { x: xy.x, y: xy.y, latlng: transformCoord(xy.x*gridLngUnit, xy.y*gridLatUnit, gridToMapMatrix) };
        }


// ------------ other geometry stuff --------

        function pt(x, y) { return { x: x, y: y } }
        function latlng(lat, lng) { return { lat: lat, lng: lng } }
        function pointWithinRect(x, y, rect) { return x>=rect[0] && x<=rect[2] && y>=rect[1] && y<=rect[3] }
        function cellContainerVertices(cell) {
            // these are used for drawing and shading the grid.  when we're drawing to precise (per-cell) coords, apply
            // a pixel-centring adjustment to get sharper lines.
            function centreCoord(c) { return Math.floor(c)+0.5 }

            if (usePreciseGrid) { return cell.vertices.map(function(ref) { var p = locContainerPt(ref); return pt(centreCoord(p.x), centreCoord(p.y)) }) }

            if (!baseCell.vertexContainerOffsets) {
                var offsets = baseCell.vertexContainerOffsets = [];
                var centroidCP = locContainerPt(baseCell.centroid);
                var m = 1;      // accuracy multiple.  storing fractional pixel offsets seems to help.  4 seems good enough.
                baseCell.vertices.forEach(function(vertLocRef) {
                    var cp = locContainerPt(vertLocRef);
                    offsets.push(pt((cp.x-centroidCP.x)/m, (cp.y-centroidCP.y)/m))
                    });
            }
            var centroidCP = locContainerPt(cell.centroid);
            return baseCell.vertexContainerOffsets.map(function(p) { return pt(p.x+centroidCP.x, p.y+centroidCP.y) })
        }
        function approxSine(x) {  // based on http://www.mclimatiano.com/faster-sine-approximation-using-quadratic-curve/
            if (x < -Math.PI) x += Math.PI*2;
            else if (x > Math.PI) x -= Math.PI*2;

            return x * ( 1.27323954 - 0.405284735 * Math.abs(x) );
        }
        function latLngToContainerPoint(ll) {
            if (containerPointsFromLeaflet) return map.latLngToContainerPoint(ll);

            // estimate container point based on the corners' lat/lng and the centre anomaly measured in recordMapBounds
            var x = (ll.lng-mapRectInContainer[0])/(mapRectInContainer[2]-mapRectInContainer[0])*mapContainerSize.x;
            var latProportion = (mapRectInContainer[3]-ll.lat)/(mapRectInContainer[3]-mapRectInContainer[1]);
            var latAdjustment = mapLatAdjustment * approxSine(latProportion*Math.PI);
            var y = latProportion*mapContainerSize.y - latAdjustment;
            return pt(Math.round(x), Math.round(y));   // Leaflet rounds, so we do too
        }
        function boundsToRectArray(bounds) { return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] };
        function recordMapBounds(bounds) {
            var rect = boundsToRectArray(bounds);
            mapRectInContainer = rect;
            var officialY = map.latLngToContainerPoint({ lng: rect[0], lat: (rect[1]+rect[3])/2 }).y;
            mapLatAdjustment = mapContainerSize.y/2 - officialY;  // amount by which our approx calc will overestimate y at map centre
            //console.log(mapLatAdjustment);
        }

        function checkPointAnomaly(ll) { // TESTING
            var leafletPt = map.latLngToContainerPoint(ll);
            var estimate = latLngToContainerPoint(ll);
            return (pt(estimate.x-leafletPt.x, estimate.y-leafletPt.y))
        }

// ------------ web worker stuff --------

        function startWebWorkers() {
            workers = [];
            workerReplies = {};
            workersAwaited = [];

            var code = "var landmarks, cellType, mapToGridMatrix, gridLatUnit, gridLngUnit, gridColumnSpacing, gridColumnWidth, gridRowSpacing, gridRowHeight;\n\n";
            [ pt, pointWithinRect, vectorMultiply, transformCoord, findCellRowCol ].forEach(function(f) { code += f.toString()+"\n\n" } )
            code += "onmessage = " + handleMessageToWorker.toString();
            //console.log(code);
            var workerObjectURL = URL.createObjectURL(new Blob([code], {type: 'text/javascript'}));
            for (var wi=0; wi<maxWorkers; wi++) {
                var id = wi;
                var worker = new Worker(workerObjectURL);
                worker.onmessage = handleMessageFromWorker;
                worker.onerror = function(e) { console.log(e) };
                worker.postMessage({msg: "load", id: id});
                workers.push(worker);
            }
        }

        function postToAllWorkers(message) {
            for (var wi=0; wi<workers.length; wi++) workers[wi].postMessage(message)
        }

        function handleMessageFromWorker(event) {
            var message = event.data;
            if (message.counts) {
                var id = message.workerID;
                var index = workersAwaited.indexOf(id);
                if (index>-1) {
                    workersAwaited.splice(index, 1);
                    var counts=message.counts;
                    // console.log(counts);
                    for (var key in counts) {
                        if (counts.hasOwnProperty(key)) {
                            var cell = lookupCellKey(key);
                            if (cell) cell.landmarkCount+=counts[key];
                        }
                    }
//console.log("results from "+id+" (" + message.examined + "): " + (Date.now()-workStartTime))
                } else console.log("Warning: ignoring excess response from worker "+id);
            } else if (message.say) console.log("worker message: "+message.say);
        }


        function handleMessageToWorker(event) {
            var message = event.data;

            switch (message.msg) {
                case "load":
                    myID = message.id;
                    postMessage({ say: "started "+myID });
                    break;
                case "init":
                    landmarks = message.landmarks;
                    break;
                case "compute":
                    var parms = message.parms;
                    cellType=parms.cellType, mapToGridMatrix=parms.mapToGridMatrix, gridLatUnit=parms.gridLatUnit, gridLngUnit=parms.gridLngUnit, gridColumnSpacing=parms.gridColumnSpacing, gridColumnWidth=parms.gridColumnWidth, gridRowSpacing=parms.gridRowSpacing, gridRowHeight=parms.gridRowHeight;

                    var landmarkRange = message.landmarkRange;
                    var viewRect = message.viewRect;
                    var counts = {}, examined=0;
                    for (var li=landmarkRange[0]; li<landmarkRange[1]; li++) {
                        var ll = landmarks[li].latlng;
                        if (pointWithinRect(ll.lng, ll.lat, viewRect)) {
                            examined++;
                            var rowCol = findCellRowCol(ll);
                            var key = rowCol.row*1024+rowCol.col;
                            var count = counts[key] || 0;
                            counts[key] = count+1;
                        }
                    }
                    postMessage({ workerID: myID, counts: counts, examined: examined });
                    break;
            }
        }
