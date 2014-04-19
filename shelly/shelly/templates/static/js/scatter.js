(function() {
var scatter = window.Plotly.Scatter = {};

scatter.PTS_LINESONLY = 20; // traces with < this many points are by default shown with points and lines, > just get lines

scatter.calc = function(gd,gdc) {
    // verify that data exists, and make scaled data if necessary
    if(!('y' in gdc) && !('x' in gdc)) { return; } // no data!

    var i, cd = [];

    // ignore as much processing as possible (and including in autorange) if trace is not visible
    if(gdc.visible===false) {
        // even if trace is not visible, need to figure out whether there are enough
        // points to trigger auto-no-lines
        if(gdc.mode || ((!gdc.x || gdc.x.length<scatter.PTS_LINESONLY) &&
          (!gdc.y || gdc.y.length<scatter.PTS_LINESONLY))) {
            return [{x:false, y:false}];
        }
        else {
            for(i=0; i<scatter.PTS_LINESONLY+1; i++) { cd.push({x:false, y:false}); }
            return cd;
        }
    }

    var xa = Plotly.Axes.getFromId(gd,gdc.xaxis||'x'),
        ya = Plotly.Axes.getFromId(gd,gdc.yaxis||'y');
    Plotly.Lib.markTime('in Scatter.calc');
    var x = xa.makeCalcdata(gdc,'x');
    Plotly.Lib.markTime('finished convert x');
    var y = ya.makeCalcdata(gdc,'y');
    Plotly.Lib.markTime('finished convert y');
    var serieslen = Math.min(x.length,y.length);

    // cancel minimum tick spacings (only applies to bars and boxes)
    xa._minDtick = 0;
    ya._minDtick = 0;

    if(x.length>serieslen) { x.splice(serieslen,x.length-serieslen); }
    if(y.length>serieslen) { y.splice(serieslen,y.length-serieslen); }

    // check whether bounds should be tight, padded, extended to zero...
    // most cases both should be padded on both ends, so start with that.
    var xOptions = {padded:true},
        yOptions = {padded:true};
    // include marker size
    if(gdc.mode && gdc.mode.indexOf('markers')!=-1) {
        var markerPad = gdc.marker ? gdc.marker.size : 0,
            sizeref = 1.6*((gdc.marker && gdc.marker.sizeref)||1),
            markerTrans;
        if(gdc.marker && gdc.marker.sizemode=='area') {
            markerTrans = function(v) { return Math.max(Math.sqrt((v||0)/sizeref),3); };
        }
        else {
            markerTrans = function(v) { return Math.max((v||0)/sizeref,3); };
        }
        xOptions.ppad = yOptions.ppad = $.isArray(markerPad) ?
            markerPad.map(markerTrans) : markerTrans(markerPad);
    }
    // TODO: text size

    // include zero (tight) and extremes (padded) if fill to zero
    if(gdc.fill=='tozerox' || (gdc.fill=='tonextx' && gd.firstscatter)) {
        xOptions.tozero = true;
    }
    // if no error bars, markers or text, or fill to y=0 remove x padding
    else if((!gdc.error_y || !gdc.error_y.visible) &&
        (['tonexty','tozeroy'].indexOf(gdc.fill)!=-1 ||
        (gdc.mode && gdc.mode.indexOf('markers')==-1 && gdc.mode.indexOf('text')==-1) || // explicit no markers/text
        (!gdc.mode && serieslen>=scatter.PTS_LINESONLY))) { // automatic no markers
            xOptions.padded = false;
            xOptions.ppad = 0;
    }

    // now check for y - rather different logic, though still mostly padded both ends
    // include zero (tight) and extremes (padded) if fill to zero
    if(gdc.fill=='tozeroy' || (gdc.fill=='tonexty' && gd.firstscatter)) {
        yOptions.tozero = true;
    }
    // tight y: any x fill
    else if(['tonextx','tozerox'].indexOf(gdc.fill)!=-1) {
        yOptions.padded = false;
    }

    Plotly.Lib.markTime('ready for Axes.expand');
    Plotly.Axes.expand(xa, x, xOptions);
    Plotly.Lib.markTime('done expand x');
    Plotly.Axes.expand(ya, y, yOptions);
    Plotly.Lib.markTime('done expand y');

    // create the "calculated data" to plot
    for(i=0;i<serieslen;i++) {
        cd.push(($.isNumeric(x[i]) && $.isNumeric(y[i])) ? {x:x[i],y:y[i]} : {x:false, y:false});
    }
    gd.firstscatter = false;
    return cd;
};

scatter.selectMarkers = function(gd,plotinfo,cdscatter) {
    var xr = d3.extent(plotinfo.x.range.map(plotinfo.x.l2c)),
        yr = d3.extent(plotinfo.y.range.map(plotinfo.y.l2c));

    cdscatter.forEach(function(d) {
        // if marker.maxdisplayed is used, select a maximum of
        // mnum markers to show, from the set that are in the viewport
        var mnum = d[0].t.mnum;
        if(!(mnum>0) || d[0].t.mode.indexOf('markers')==-1) { return; } // TODO: remove some as we get away from the viewport

        var cd = d.filter(function(v) { return v.x>=xr[0] && v.x<=xr[1] && v.y>=yr[0] && v.y<=yr[1]; }),
            inc = Math.ceil(cd.length/mnum),
            tnum = 0;
        cdscatter.forEach(function(cdi) {
            if(cdi[0].t.mnum>0 && cdi[0].t.curve<d[0].t.curve) { tnum++; }
        });
        // if multiple traces use maxdisplayed, stagger which markers we display
        // this formula offsets successive traces by 1/3 of the increment, adding
        // an extra small amount after each triplet so it's not quite periodic
        var i0 = Math.round(tnum*inc/3 + Math.floor(tnum/3)*inc/7.1);
        // for error bars: save in cd which markers to show so we don't have to repeat this
        d.forEach(function(v){ delete v.vis; });
        cd.forEach(function(v,i) { if(Math.round((i+i0)%inc)===0) { v.vis = true; } });
    });


};

scatter.plot = function(gd,plotinfo,cdscatter) {
    var xa = plotinfo.x,
        ya = plotinfo.y;
    // make the container for scatter plots (so error bars can find them along with bars)
    var scattertraces = plotinfo.plot.selectAll('g.trace.scatter') // <-- select trace group
        .data(cdscatter);
    scattertraces.enter().append('g') // <-- add a trace for each calcdata
        .attr('class','trace scatter')
        .style('stroke-miterlimit',2);

    // used by both line and point decimation to determine how close two points
    // need to be to be grouped
    function getTolerance(x,y,w) {
        return (0.75 + 10*Math.max(0,
            Math.max(-x,x-xa._length)/xa._length,
            Math.max(-y,y-ya._length)/ya._length)) * Math.max(w||1, 1);
    }

    // BUILD LINES AND FILLS
    var prevpts='',tozero,tonext,nexttonext;
    scattertraces.each(function(d){ // <-- now, iterate through arrays of {x,y} objects
        var t=d[0].t; // <-- get trace-wide formatting object
        if(t.visible===false) { return; }
        var i=-1,tr=d3.select(this);
        // make the fill-to-zero path now, so it shows behind the line
        // have to break out of d3-style here (data-curve attribute) because fill to next
        // puts the fill associated with one trace grouped with the previous
        tozero = (t.fill.substr(0,6)=='tozero' || (t.fill.substr(0,2)=='to' && !prevpts)) ?
            tr.append('path').classed('js-fill',true).attr('data-curve',t.cdcurve) : null;
        // make the fill-to-next path now for the NEXT trace, so it shows behind both lines
        // nexttonext was created last time, but give it this curve's data for fill color
        if(nexttonext) { tonext = nexttonext.datum(d); }
        // now make a new nexttonext for next time
        nexttonext = tr.append('path').classed('js-fill',true);
        var pt0=null, pt1=null;
        // pts is the current path we're building... it has the form "x,yLx,y...Lx,y"
        // and later we add the first letter, either "M" if this is the beginning of
        // the path, or "L" if it's being concatenated on something else
        // pts ends at a missing point, and gets restarted at the next point (unless t.connectgaps is truthy)
        // pts2 is all paths for this curve, joined together straight across gaps
        var pts = '', pts2 = '', atLeastTwo;

        // for decimation: store pixel positions of things we're working with as [x,y]
        var lastEntered, tryHigh, tryLow, prevPt, pti;
        // lastEnd: high or low, which is most recent?
        // decimationMode: -1 (not decimating), 0 (x), 1 (y)
        // decimationTolerance: max pixels between points to allow decimation
        var lastEnd, decimationMode, decimationTolerance;

        // add a single [x,y] to the pts string
        function addPt(pt) {
            atLeastTwo = true;
            add0(pt); // implicit array stringifying
            pt1 = pt;
        }

        // simpler version where we don't need the extra assignments
        // but I made this a function so in principle we can do more than just lines in the
        // future, like smoothing splines.
        function add0(pt) {
            if(!$.isNumeric(pt[0]) || !$.isNumeric(pt[1])) { return; }
            pts += 'L' + pt;
        }

        // finish one decimation step - now decide what to do with tryHigh, tryLow, and prevPt
        // (prevPt is the last one before the decimation ended)
        function finishDecimation(pt) {
            if(pt) { prevPt = pt; }
            if(prevPt==tryHigh) {
                // ended this decimation on the high point, so add the low first (unless there was only one point)
                if(tryHigh!=tryLow) { add0(tryLow); }
            }
            else if(prevPt==tryLow || tryLow==tryHigh) {
                // ended on the low point (or high and low are same), so add high first
                add0(tryHigh);
            }
            else if(lastEnd=='high') { add0(tryLow); add0(tryHigh); } // low, then high, then prev
            else { add0(tryHigh); add0(tryLow); } // high, low, prev
            // lastly, add the endpoint of this decimation
            addPt(prevPt);
            // reset status vars
            lastEntered = prevPt;
            tryHigh = tryLow = null;
            decimationMode = -1;
        }

        while(i<d.length) {
            pts='';
            atLeastTwo = false;
            lastEntered = null;
            decimationMode = -1;
            for(i++; i<d.length; i++) {
                pti = [xa.c2p(d[i].x), ya.c2p(d[i].y)];
                if(!$.isNumeric(pti[0])||!$.isNumeric(pti[1])) { // TODO: smart lines going off the edge?
                    if(t.connectgaps) { continue; }
                    else { break; }
                }

                // DECIMATION
                // first point: always add it, and prep the other variables
                if(!lastEntered) {
                    lastEntered = pti;
                    pts += lastEntered;
                    if(!pt0) { pt0 = lastEntered; }
                    continue;
                }

                // figure out the decimation tolerance - on-plot has one value, then it increases as you
                // get farther off-plot. the value is in pixels, and is based on the line width, which
                // means we need to replot if we change the line width
                decimationTolerance = getTolerance(pti[0],pti[1],t.lw);
                // if the last move was too much for decimation, see if we're starting a new decimation block
                if(decimationMode<0) {
                    // first look for very near x values (decimationMode=0), then near y values (decimationMode=1)
                    if(Math.abs(pti[0]-lastEntered[0]) < decimationTolerance) { decimationMode = 0; }
                    else if(Math.abs(pti[0]-lastEntered[1]) < decimationTolerance) { decimationMode = 1; }
                    else { // no decimation here - add this point and move on
                        lastEntered = pti;
                        addPt(lastEntered);
                        continue;
                    }
                }
                else if(Math.abs(pti[decimationMode] - lastEntered[decimationMode]) >= decimationTolerance) {
                    // we were decimating, now we're done
                    finishDecimation(pti);
                    continue;
                }
                // OK, we're collecting points for decimation, for realz now.
                prevPt = pti;
                if(!tryHigh || prevPt[1-decimationMode]>tryHigh[1-decimationMode]) {
                    tryHigh = prevPt;
                    lastEnd = 'high';
                }
                if(!tryLow || prevPt[1-decimationMode]<tryLow[1-decimationMode]) {
                    tryLow = prevPt;
                    lastEnd = 'low';
                }
            }
            if(decimationMode>=0) { // end of the data is mid-decimation - close it out.
                finishDecimation(pti);
            }
            if(pts) {
                pts2+=(pts2 ? 'L' : '') + pts;
                if(t.mode.indexOf('lines')!=-1 && atLeastTwo) {
                    tr.append('path').classed('js-line',true).attr('d','M'+pts);
                }
            }
        }
        if(pts2) {
            if(tozero) {
                if(pt0 && pt1) {
                    if(t.fill.charAt(t.fill.length-1)=='y') { pt0[1]=pt1[1]=ya.c2p(0,true); }
                    else { pt0[0]=pt1[0]=xa.c2p(0,true); }
                    // fill to zero: full trace path, plus extension of the endpoints to the appropriate axis
                    tozero.attr('d','M'+pts2+'L'+pt1+'L'+pt0+'Z');
                }
            }
            else if(t.fill.substr(0,6)=='tonext' && pts2 && prevpts) {
                // fill to next: full trace path, plus the previous path reversed
                tonext.attr('d','M'+pts2.split('L').reverse().join('L')+'L'+prevpts+'Z');
            }
            prevpts = pts2;
        }
    });

    // remove paths that didn't get used
    scattertraces.selectAll('path:not([d])').remove();

    // BUILD SCATTER POINTS
    // decimate all the scatter traces in this subplot together
    // commented out for now because it doesn't help much if at all, and may have unintended consequences
    // var newcds = cdscatter.slice(),
    //     covered = {},
    //     cd, newcd, i, j, d, d0, x, y, tol, xr, yr, t, d_c, d_op, d0_c, d0_op, cf0, cf;
    // // find the minimum point size
    // var msMin = gd.layout._size.w,
    //     totalPts = 0, sizeFn, ms, maList = [];
    // function arearef(v,r) { return Math.sqrt(t/r); }
    // function lenref(v,r) { return v/r; }
    // for(i=0; i<cdscatter.length; i++) {
    //     cd = cdscatter[i];
    //     t = cd[0].t;
    //     if(t.mode.indexOf('markers')==-1 || t.visible===false ||
    //         'ms' in cd[0] || 'mx' in cd[0]) { continue; }

    //     sizeFn = (t.msm=='area') ? arearef : lenref;
    //     ms = sizeFn(t.ms/2, t.msr||1);
    //     maList.push(ms*ms); // save the relative marker area for each trace
    //     totalPts += cd.length;
    //     msMin = Math.max(ms/3,1);
    // }
    // // now do the decimation
    // if(totalPts>2000) { // too few points to matter
    //     // if(totalPts<10000) { msMin*=totalPts/10000; } // intermediate - do less decimation
    //     // start from the last scatter trace and work backward - because the last one is on top
    //     for(i=newcds.length-1; i>=0; i--) {
    //         cd = cdscatter[i];
    //         t = cd[0].t;
    //         // are there visible markers? also don't try to do this for bubble
    //         // or multi-symbol charts... that's a can of worms.
    //         if(t.mode.indexOf('markers')==-1 || t.visible===false ||
    //             'ms' in cd[0] || 'mx' in cd[0]) { continue; }
    //         newcd = [];
    //         // like traces, start from the last point and work backward
    //         for(j=cd.length-1; j>=0; j--) {
    //             d = $.extend({},cd[j]);
    //             x = xa.c2p(d.x);
    //             y = ya.c2p(d.y);
    //             tol = getTolerance(x,y,msMin);
    //             xr = Math.round(tol*Math.round(x/tol));
    //             yr = Math.round(tol*Math.round(y/tol));
    //             if(!covered[yr]) { covered[yr] = {}; }
    //             d0 = covered[yr][xr];
    //             if(d0 && maList[i]<=maList[d0.i]) {
    //                 // already have a point here (d0) that's no bigger than the new one
    //                 // but if this point is transparent, we need to alter it
    //                 if(d0.mo<1 || d0.fo<1) {
    //                     // color of the new point
    //                     d_c = tinycolor(d.mc || t.mc || (d.t ? d.t.mc : '')).toRgb();
    //                     // total opacity of the new point, including marker, fill, and size scaling
    //                     d_op = ((d.mo+1 || t.mo+1 || (d.t ? d.t.mo : 0) +1) - 1) *
    //                         d_c.a * maList[i]/maList[d0.i];
    //                     // don't try to do anything if the new point is nearly transparent
    //                     if(d_op<0.001) { continue; }
    //                     // new total opacity for d0
    //                     d0_op = 1-(1-d0.mo*d0.fo)*(1-d_op);
    //                     d0_c = tinycolor(d0.mc).toRgb();
    //                     // first apply new color to the marker fill, then to marker opacity if we need more
    //                     d0_c.a = d0_op/d0.mo;
    //                     if(d0_c.a>1) { d0_c.a=1; d0.mo = d0_op; }
    //                     // fraction of color to come from each marker
    //                     cf0 = 1/(1+d_op*(1/d0_op-1));
    //                     cf = 1-cf0;
    //                     // now make the new marker fill color
    //                     d0_c.r = Math.round(cf0*d0_c.r+cf*d_c.r);
    //                     d0_c.g = Math.round(cf0*d0_c.g+cf*d_c.g);
    //                     d0_c.b = Math.round(cf0*d0_c.b+cf*d_c.b);
    //                     d0.mc = 'rgba('+d0_c.r+','+d0_c.g+','+d0_c.b+','+d0_c.a+')';
    //                 }
    //             }
    //             else {
    //                 // this point gets included
    //                 d0 = $.extend({},d,{
    //                     // save pixel positions so we don't have to calculate them again
    //                     xp: x,
    //                     yp: y,
    //                     // indclude color explicitly so we don't have to do it later
    //                     mc: d.mc || t.mc || (d.t ? d.t.mc : ''),
    //                     // explicitly insert opacity so we can combine points easily
    //                     mo: ((d.mo+1 || t.mo+1 || (d.t ? d.t.mo : 0) +1) - 1),
    //                     fo: Plotly.Drawing.opacity(d_c),
    //                     // curve number, so we can get its marker size
    //                     i: i
    //                 });
    //                 covered[yr][xr] = d0;
    //                 newcd.push(d0);
    //             }
    //         }
    //         newcds[i] = newcd.reverse();
    //         // put trace-wide properties in here explicitly, in case the first point is deleted
    //         newcds[i][0].t = t;
    //     }
    // }

    function visFilter(d){
        return d.filter(function(v){ return v.vis; });
    }

    scattertraces.append('g')
        .attr('class','points')
        .each(function(d){
            var t = d[0].t,
                s = d3.select(this),
                showMarkers = t.mode.indexOf('markers')!=-1,
                showText = t.mode.indexOf('text')!=-1;
            if((!showMarkers && !showText) || t.visible===false) { s.remove(); }
            else {
                if(showMarkers) {
                    s.selectAll('path')
                        .data(t.mnum>0 ? visFilter : Plotly.Lib.identity)
                        .enter().append('path')
                        .call(Plotly.Drawing.translatePoints,xa,ya);
                    // decimated version commented out for now
                    // var pts = s.selectAll('path')
                    //     .data(function(d,i) { return newcds[i]; });
                    // pts.enter().append('path')
                    //     .call(Plotly.Drawing.translatePoints,xa,ya);
                    // pts.exit().remove();
                }
                if(showText) {
                    s.selectAll('text')
                        .data(Plotly.Lib.identity) // not going to try to decimate text...
                        .enter().append('text')
                        .call(Plotly.Drawing.translatePoints,xa,ya);
                }
            }
        });
};

scatter.style = function(s) {
    s.style('opacity',function(d){ return d[0].t.op; });

    s.selectAll('g.points')
        .each(function(d){
            d3.select(this).selectAll('path')
                .call(Plotly.Drawing.pointStyle,d.t||d[0].t);
            d3.select(this).selectAll('text')
                .call(Plotly.Drawing.textPointStyle,d.t||d[0].t);
        });

    s.selectAll('g.trace path.js-line')
        .call(Plotly.Drawing.lineGroupStyle);

    s.selectAll('g.trace path.js-fill')
        .call(Plotly.Drawing.fillGroupStyle);
};


}()); // end Scatter object definition