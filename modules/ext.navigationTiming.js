/**
 * JavaScript module for logging client-side latency measurements.
 * @see https://mediawiki.org/wiki/Extension:NavigationTiming
 *
 * @licence GNU GPL v2 or later
 * @author Ori Livneh <ori@wikimedia.org>
 */
( function ( mw, $ ) {
	'use strict';

	var timing = window.performance ? performance.timing : null;

	function inSample() {
		var factor = mw.config.get( 'wgNavigationTimingSamplingFactor' );
		if ( !$.isNumeric( factor ) || factor < 1 ) {
			return false;
		}
		return Math.floor( Math.random() * factor ) === 0;
	}

	/** Assert that the attribute order complies with the W3C spec. **/
	function isCompliant() {
		// Tests derived from <http://w3c-test.org/web-platform-tests/
		// master/navigation-timing/test_timing_attributes_order.html>
		var attr, current, last = 0, order = [
			'loadEventEnd',
			'loadEventStart',
			'domContentLoadedEventEnd',
			'domContentLoadedEventStart',
			'domInteractive',
			'responseEnd',
			'responseStart',
			'requestStart',
			'connectEnd',
			'connectStart'
		];

		if ( !timing ) {
			// Browser does not implement the Navigation Timing API.
			return false;
		}

		if ( /Firefox\/[78]\b/.test( navigator.userAgent ) ) {
			// The Navigation Timing API is broken in Firefox 7 and 8 and reports
			// inaccurate measurements. See <https://bugzilla.mozilla.org/691547>.
			return false;
		}

		while ( ( attr = order.pop() ) !== undefined ) {
			current = timing[attr];
			if ( current < 0 || current < last ) {
				return false;
			}
			last = current;
		}
		return true;
	}

	function getNavTiming() {
		// Workaround for IE 9 bug: IE 9 sets a default value of zero for
		// navigationStart, rather than use fetchStart as the specification
		// requires. See <https://bugzilla.wikimedia.org/46474> for details.
		var navStart = timing.navigationStart || timing.fetchStart,
			timingData = {};

		$.each( [
			'connectEnd',
			'connectStart',
			'domComplete',
			'domInteractive',
			'fetchStart',
			'loadEventEnd',
			'loadEventStart',
			'requestStart',
			'responseEnd',
			'responseStart'
		], function ( i, marker ) {
			var measure = timing[marker] - navStart;
			if ( $.isNumeric( measure ) && measure > 0 ) {
				timingData[ marker ] = measure;
			}
		} );

		if ( timing.domainLookupStart ) {
			timingData.dnsLookup = timing.domainLookupEnd - timing.domainLookupStart;
		}

		if ( timing.redirectStart ) {
			timingData.redirectCount = performance.navigation.redirectCount;
			timingData.redirecting = timing.redirectEnd - timing.redirectStart;
		}

		return timingData;
	}

	function getMediaWikiTiming() {
		var mediaWikiLoadEnd = mw.now ? mw.now() : new Date().getTime(),
			event = {
				isHttps: location.protocol === 'https:',
				isAnon: mw.config.get( 'wgUserId' ) === null
			},
			page = {
				pageId: mw.config.get( 'wgArticleId' ),
				namespaceId: mw.config.get( 'wgNamespaceNumber' ),
				revId: mw.config.get( 'wgCurRevisionId' ),
				action: mw.config.get( 'wgAction' ), // view, submit, etc.
				runtime: mw.config.get( 'wgPoweredByHHVM' ) ? 'HHVM' : 'PHP5'
			},
			isSpecialPage = !!mw.config.get( 'wgCanonicalSpecialPageName' ),
			mobileMode = mw.config.get( 'wgMFMode' );

		if ( window.mediaWikiLoadStart ) {
			event.mediaWikiLoadComplete = Math.round( mediaWikiLoadEnd - mediaWikiLoadStart );
		}

		if ( window.Geo && typeof window.Geo.country === 'string' ) {
			event.originCountry = window.Geo.country;
		}

		// Omit page information for special pages: they don't have real page
		// IDs or revisions. (They appear as 0 to client-side code.)
		if ( !isSpecialPage ) {
			$.extend( event, page );
		}

		if ( typeof mobileMode === 'string' && mobileMode.indexOf( 'desktop' ) === -1 ) {
			event.mobileMode = mobileMode;
		}

		return event;
	}

	function getPaintTiming() {
		var loadTimes;

		// on Chrome we need to call a method to get the paint timing values; this is non-standard
		// and there is no safe way to feature-test it, so we'll just try and discard exceptions
		try {
			loadTimes = chrome.loadTimes();
			// the loadTimes API returns seconds (with microsecond precision), we multiply by 1000
			// to get results comparable with the NavigationTiming API
			return {
				firstPaint: Math.floor( loadTimes.firstPaintTime * 1000 ),
				firstPaintAfterLoad: Math.floor( loadTimes.firstPaintAfterLoadTime * 1000 )
			};
		} catch( e ) {}

		if ( timing && timing.msFirstPaint ) {
			// IE version of first paint time
			// http://msdn.microsoft.com/en-us/library/ff974719
			return {
				firstPaint: timing.msFirstPaint
			};
		}

		return {};
	}

	function emitNavigationTiming() {
		var event = getMediaWikiTiming();

		// The Navigation Timing API provides an attribute that can be used to
		// know if a page load was triggered by link click or manual URL entry
		// vs. by using the back/forward button or by reloading the page. A
		// value of 0 corresponds with TYPE_NAVIGATENEXT, which indicates a
		// normal page load.
		if ( isCompliant() && performance.navigation.type === 0 ) {
			$.extend( event, getNavTiming() );
		}

		$.extend( event, getPaintTiming() );

		mw.eventLog.logEvent( 'NavigationTiming', event );
	}

	function emitSaveTiming() {
		if (
			mw.config.get( 'wgPostEdit' )
			&& isCompliant()
			&& performance.navigation.type === 0
			&& performance.timing.navigationStart > 0
		) {
			mw.eventLog.logEvent( 'SaveTiming', {
				duration: performance.timing.responseStart - performance.timing.navigationStart,
				runtime: mw.config.get( 'wgPoweredByHHVM' ) ? 'HHVM' : 'PHP5'
			} );
		}
	}

	// Ensure we run after loadEventEnd.
	$( window ).load( function () {
		setTimeout( function () {
			if ( inSample() ) {
				emitNavigationTiming();
			}
			mw.hook( 'postEdit' ).add( emitSaveTiming );
		} );
	} );

} ( mediaWiki, jQuery ) );
