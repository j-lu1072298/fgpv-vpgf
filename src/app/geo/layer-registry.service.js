/* global RV */
(() => {
    'use strict';

    /**
     * @ngdoc service
     * @module layerRegistry
     * @memberof app.geo
     * @requires gapiService
     * @requires mapService
     * @requires layerTypes
     * @requires configDefaults
     * @description
     *
     * The `layerRegistry` factory tracks active layers and constructs legend, provide all layer-related functionality like registering, removing, changing visibility, changing opacity, etc.
     *
     */
    angular
        .module('app.geo')
        .factory('layerRegistry', layerRegistryFactory);

    function layerRegistryFactory($q, $timeout, $translate, gapiService, legendService, tooltipService, Geo, $filter) {

        return (geoState, config) => layerRegistry(geoState, geoState.mapService.mapObject, config);

        function layerRegistry(geoState, mapObject, config) {

            const layers = {};

            // this `service` object will be exposed through `geoService`
            const service = {
                /**
                 * Reference to the map legend
                 * @member legend
                 */
                legend: null,
                /**
                 * Collection of LayerRecord objects.  Maps `LayerRecord.id` -> `LayerRecord`.
                 * @see LayerRecord
                 * @member layers
                 */
                layers,

                constructLayers,
                removeLayer,
                zoomToScale,
                zoomToBoundary,
                reloadLayer,
                snapshotLayer,
                aliasedFieldName,
                getLayersByType,
                getRcsLayerIDs,
                getAllQueryableLayerRecords,
                moveLayer,
                checkDateType,
                setBboxState,
                getLayerMapIndex,
                _refactorIsLayerInMapStack // temporary function, will likely be removed after refactor
            };

            const ref = {
                legendService: legendService(config, service)
            };

            service.legend = ref.legendService.legend;

            // set event handler for extent changes
            // TODO consider listening to the $rootScope.$broadcast 'extentChange' event instead
            gapiService.gapi.events.wrapEvents(
                geoState.mapService.mapObject,
                {
                    'extent-change': extentChangeHandler
                }
            );

            // TODO this is bad. will change after big refactor.
            // holds a reference to any hovertip, so we can change and smite it later
            const hovertipState = {
                tipRef: null,
                tipContent: null
            };

            // store service in geoState
            geoState.layerRegistry = service;

            return service;

            /***/

            /**
             * Checks whether the supplied layer id is in the map stack;
             * This should be not needed after state machine refactor;
             * @function _refactorIsLayerInMapStack
             * @private
             * @param  {Number}  layerId   layer id
             * @param  {Number}  sortGroup layer sort group
             * @return {Boolean}           indicates if the layer is in the map stack
             */
            function _refactorIsLayerInMapStack(layerId, sortGroup) {
                const mapStackSwitch = [
                    mapObject.graphicsLayerIds,
                    mapObject.layerIds
                ];

                return mapStackSwitch[sortGroup].indexOf(layerId.replace('placeholder', '')) !== -1;
            }

            /**
             * Retrieves all layer records of the specified type.
             * @function getLayersByType
             * @param {String} layerType the type of layer to be filtered
             * @return {Array} array of  layer records
             */
            function getLayersByType(layerType) {
                return Object.keys(layers).map(key => layers[key])
                    .filter(lr => lr.config.layerType === layerType);
            }

            /**
             * Returns an array of ids for rcs added layers
             *
             * @function getRcsLayerIDs
             * @returns {Array}     list of rcs layers' ids
             */
            function getRcsLayerIDs() {
                return Object.keys(layers)
                    .filter(id => ((layers[id].origin || layers[id].initialConfig.origin) === 'rcs') &&
                        !layers[id].deleted)
                    .map(id => id.split('.')[1]);
            }

            // FIXME  add a check to see if layer has config setting for not supporting a click
            /**
             * Retrieves all queryable layer records.
             * First filters for all queryable layers, then filters for layers which are
             * in a valid state.
             * @function getAllQueryableLayerRecords
             * @return {Array} array of layer records
             */
            function getAllQueryableLayerRecords() {
                return Object.keys(layers).map(key => layers[key])
                    .filter(layerRecord => Geo.Layer.QUERYABLE.indexOf(layerRecord.config.layerType) !== -1)
                    .filter(layerRecord => layerRecord.state !== Geo.Layer.States.ERROR);
            }

            /**
             * Handler for map extent change.
             * @function extentChangeHandler
             * @private
             * @param  {Object} params event parameters
             */
            function extentChangeHandler(params) {
                geoState.mapService.clearHilight();
                if (params.levelChange) {
                    // refresh scale state of all layers
                    Object.keys(service.layers).forEach(layerId => {
                        setScaleDepState(layerId);
                    });

                    // nuke any hovertips
                    hoverHandler({ type: 'forceClose' });
                }

                // if extent suppressor is on, enforce it here
                if (config.map.restrictNavigation && geoState.maxExtent) {
                    const extentTest = gapiService.gapi.mapManager.enforceBoundary(params.extent, geoState.maxExtent);
                    if (extentTest.adjusted) {
                        // NOTE: the map will not do a smooth pan because we have pan duration
                        // set to 0 for reasons (keyboard pan?).
                        // See http://jsfiddle.net/bbunker/JP565/ for sample of default behavior
                        // NOTE: we use centerAt instead of setExtent, as setExtent can sometimes
                        // cause the zoom level to change at extreme scales
                        geoState.mapService.mapObject.centerAt(extentTest.newExtent.getCenter());
                    }
                }
            }

            /**
             * Update scale status of a layer.
             * @function setScaleDepState
             * @private
             * @param  {String} layerId       layer id of layer to update
             */
            function setScaleDepState(layerId) {
                const lr = service.layers[layerId];
                makeScaleSet(lr).then(scaleSet => lr.legendEntry.setLayerScaleFlag(scaleSet));
            }

            /**
             * Determines if a scale is outside the given bounds.
             * @function isOffScale
             * @private
             * @param  {Integer} scale           scale value to test
             * @param  {Integer} minScale        minimum invalid scale level for zoom out, 0 for none
             * @param  {Integer} maxScale        maximum invalid scale level for zoom in, 0 for none
             * @return {Object}                  scaleSet.value = true if scale is outside valid bound
             */
            function isOffScale(scale, minScale, maxScale) {
                // GIS for dummies.
                // scale increases as you zoom out, decreases as you zoom in
                // minScale means if you zoom out beyond this number, hide the layer
                // maxScale means if you zoom in past this number, hide the layer
                // 0 value for min or max scale means there is no hiding in effect
                const scaleSet = {
                    value: false,
                    zoomIn: false
                };

                // check if out of scale and set zoom direction to scaleSet
                if (scale < maxScale && maxScale !== 0) {
                    scaleSet.value = true;
                    scaleSet.zoomIn = false;
                } else if (scale > minScale && minScale !== 0) {
                    scaleSet.value = true;
                    scaleSet.zoomIn = true;
                }

                return scaleSet;
            }

            /**
             * Generate a mapping of feature indexes to off-scale status for a layer.
             * @function makeScaleSet
             * @private
             * @param  {Object} layerRecord   a LayerRecord object
             * @return {Promise}              resolves with mapping of layer indexes to boolean off-scale status
             */
            function makeScaleSet(layerRecord) {

                const currScale = geoState.mapService.mapObject.getScale();
                const result = {};
                const promises = []; // list of promises that must resolve before we are ready

                // TODO will likely need to adjust logic to take WMS/OpenFormat layers scale properties
                if (layerRecord.attributeBundle && layerRecord.attributeBundle.indexes) {
                    // attributes were loaded for this layer. iterate through all sublayers in the bundle
                    layerRecord.attributeBundle.indexes.forEach(featureIdx => {
                        // wait for medatadata to load, then calculate the scale
                        promises.push(layerRecord.attributeBundle[featureIdx].layerData.then(layerData => {
                            result[featureIdx] = isOffScale(currScale, layerData.minScale, layerData.maxScale);
                        }));

                    });
                } else {
                    // grab min and max from layer itself, use zero as featureIdx
                    result['0'] = isOffScale(currScale, layerRecord._layer.minScale, layerRecord._layer.maxScale);
                }

                // promise of result that resovles after all promises[] resolve
                return $q.all(promises).then(() => result);
            }

            /**
             * Given a LayerRecord find the position it currently occupies within the map.
             * @function getLayerMapIndex
             * @param {LayerRecord} layerRecord
             * @return {Number} An integer specifying the position of the layer within the appropriate ESRI map stack
             */
            function getLayerMapIndex(layerRecord) {
                const mapStackSwitch = [mapObject.graphicsLayerIds, mapObject.layerIds];
                return mapStackSwitch[layerRecord.legendEntry.sortGroup].indexOf(layerRecord.layerId);
            }

            /**
             * Finds a position at which to insert the source layer so it's positioned directly above target layer (if one specified).
             * If the target layer is no specified, the source layer is placed at the bottom of its sort group.
             *
             * NOTE the ESRI map stack does not reflect the legend and is arranged in reverse order
             * for ESRI low index = low drawing order; legend: low index = high drawing order.
             * See design notes in https://github.com/fgpv-vpgf/fgpv-vpgf/issues/514 for more details.
             *
             * @function getLayerInsertPosition
             * @param {String} sourceId the id of the layer to be moved
             * @param {String} targetId the id of the layer the target layer will be moved on top of; can be -1, if its the end of the list
             * @return {Number}          index at which the source layer should be inserted in the map stack
             */
            function getLayerInsertPosition(sourceId, targetId) {
                const sourceEntry = service.layers[sourceId].legendEntry;
                const targetEntry = typeof targetId !== 'undefined' ? service.layers[targetId].legendEntry : null;
                const mapStackSwitch = [mapObject.graphicsLayerIds, mapObject.layerIds];

                const sourceIndex = getLayerMapIndex(service.layers[sourceId]);
                let targetIndex;

                // if targetEntry is null, meaning the layer is dropped at the end of the list or
                // the layer is dropped on top of a different group
                if (targetEntry === null || sourceEntry.sortGroup !== targetEntry.sortGroup) {
                    // put the layer at the bottom of its sort group on top of any unregistered layers (basemap layers)
                    // this finds the first layer which is in the map stack and not registered (basemap layer)
                    targetIndex = mapStackSwitch[sourceEntry.sortGroup].findIndex(layerId =>
                        service.layers.hasOwnProperty(layerId));
                    targetIndex = targetIndex !== -1 ? targetIndex : mapStackSwitch[sourceEntry.sortGroup].length;

                // if the layer is dropped on another layer in its sort group, get index of that layer
                } else if (sourceEntry.sortGroup === targetEntry.sortGroup) {
                    // get the index of the target layer in the appropriate map stack
                    targetIndex = mapStackSwitch[sourceEntry.sortGroup].indexOf(targetId);

                    // need to add 1 when moving layer up in the legend (down in the map stack)
                    targetIndex += sourceIndex > targetIndex ? 1 : 0;
                } else {
                    // TODO: I'm not sure what happened; unforseen condition
                    throw new Error('Halp!');
                }

                return targetIndex;
            }

            /**
             * Move a source layer within the map on top (visually) of the target layer.
             *
             * NOTE this does not modify the legend, movement within the legend should be handled separately, ideally
             * calling this function immediately before or after the legend is updated.
             *
             * IMPORTANT NOTE: targetId __must__ be the id of the layer which is actually in the map stack; this can't be a placholder which is not added to the map object.
             *
             * @function moveLayer
             * @param {String} sourceId the id of the layer to be moved
             * @param {String} targetId the id of the layer the target layer will be moved on top of; can be -1, if its the end of the list
             */
            function moveLayer(sourceId, targetId) {
                const sourceLayer = service.layers[sourceId]._layer;
                const targetIndex = getLayerInsertPosition(sourceId, targetId);

                _testSyncCheck();

                mapObject.reorderLayer(sourceLayer, targetIndex);
            }

            /**
             * This is temporary function to make sure the mapstack and legend is in sync;
             * @function _testSyncCheck
             * @private
             */
            function _testSyncCheck() {
                // remove all layer id from the map stacks which are not present in the legend
                const fullMapStack =
                    [].concat(mapObject.graphicsLayerIds.slice().reverse(), mapObject.layerIds.slice().reverse())
                    .filter(layerId => service.layers.hasOwnProperty(layerId));

                // remove all layer ids from the legend which are not preset in the map stack
                const fullLegendStack = service.legend.items
                    .filter(entry => _refactorIsLayerInMapStack(entry.id, entry.sortGroup))
                    .map(entry => entry.id);

                // compare the order of layer ids in both arrays - they should match
                fullMapStack.forEach((layerId, index) => {
                    if (fullLegendStack[index] !== layerId) {
                        RV.logger.error('layerRegistryService', `map stack is out of ` +
                            `sync - ${fullLegendStack[index]} !== ${layerId}`);
                        RV.logger.warn('layerRegistryService', 'fullMapStack', fullMapStack);
                        RV.logger.warn('layerRegistryService', 'fullLegendStack', fullLegendStack);
                        return;
                    }
                });
            }

            /**
             * Set the visibility of the bounding box for the specified layer.
             * FIXME this should move into a method on LegendEntry
             * @function setBboxState
             * @param {Object} layerEntry the layer entry used to generate the bounding box
             * @param {Boolean} visible the visibility state of the bounding box,
             * it is permitted to attempt to transition from true->true or false->false
             * these transitions will be ignored by the method
             */
            function setBboxState(layerEntry, visible) {
                const layerRecord = layers[layerEntry.id];
                if (!visible) {
                    if (layerRecord.bbox) {
                        layerRecord.destroyBbox(mapObject);
                    }
                    return;
                }
                if (layerRecord.bbox) {
                    return;
                }
                layerRecord.createBbox(mapObject);
            }

            /**
             * Creates esri layer object for a set of layer config objects, triggers attribute loading on layer load event and adds it to the legend afterwards.
             * @function constructLayers
             * @param  {Array} layerBlueprints array of layer configuration objects
             */
            function constructLayers(layerBlueprints) {
                layerBlueprints.forEach(layerBlueprint => {
                    // get the layer config from blueprint
                    // TODO: decouple identifyservice from everything
                    layerBlueprint.generateLayer().then(lr => {
                        registerLayerRecord(lr);
                        const pos = createPlaceholder(lr);
                        RV.logger.log('layerRegistryService', `adding *${lr.config.name}* to map at _${pos}_`);

                        // TODO replace with existing function gapiService.gapi.proj.graphicsUtils.graphicsExtent()
                        // get the bbox extent if not defined
                        // it is calculated here to avoid calls when we enable bbox in settings
                        if (lr._layer.fullExtent &&
                            typeof lr._layer.fullExtent.xmax === 'undefined') {
                            lr._layer.fullExtent.spatialReference.wkid = lr._layer.graphics[0]
                                                                            ._extent.spatialReference.wkid;
                            lr._layer.fullExtent.xmax = Math.max(...lr._layer.graphics.map(o => o._extent.xmax));
                            lr._layer.fullExtent.xmin = Math.min(...lr._layer.graphics.map(o => o._extent.xmin));
                            lr._layer.fullExtent.ymax = Math.max(...lr._layer.graphics.map(o => o._extent.ymax));
                            lr._layer.fullExtent.ymin = Math.min(...lr._layer.graphics.map(o => o._extent.ymin));
                        }

                        lr.addStateListener(makeFirstLoadHandler(lr));
                        mapObject.addLayer(lr._layer, pos);
                        // HACK: for a file-based layer, call onLoad manually since such layers don't emmit events
                        if (lr._layer.loaded) {
                            lr.onLoad();
                            lr.onUpdateEnd();
                        }

                        // add listeners for hover tips
                        if (lr.config.layerType === Geo.Layer.Types.ESRI_FEATURE &&
                            lr.config.options.hoverTips.enabled) {
                            lr.addHoverListener(hoverHandler);
                        }

                    });
                });
            }

            // this should be in legend service
            // it should bind layerRecord.legendEntry after creating the placeholder
            function createPlaceholder(lr) {
                const sourceIndex = ref.legendService.addPlaceholder(lr);
                let targetId = service.legend.items[sourceIndex + 1];

                // FIXME: remove 'placeholder' part of the id; should be fixed by refactor - split layer id and legend id on legend entry
                targetId = typeof targetId === 'undefined' ? targetId : targetId.id.replace('placeholder', '');
                return getLayerInsertPosition(lr.layerId, targetId);

            }

            // FIXME add docs
            function makeFirstLoadHandler(lr) {
                const firstListener = state => {
                    if (state !== Geo.Layer.States.LOADED) { return; }
                    lr.removeStateListener(firstListener);
                    const opts = lr.legendEntry.options;
                    if (opts.hasOwnProperty('boundingBox') && opts.boundingBox.value) {
                        setBboxState(lr.legendEntry, true);
                    }
                    const wkid = geoState.mapService.mapObject.spatialReference.wkid;
                    if (lr.config.layerType === 'esriTile' && lr._layer.spatialReference.wkid !== wkid) {
                        opts.visibility.enabled = false;
                        opts.visibility.value = false;
                    }
                    setScaleDepState(lr.layerId);
                };
                return firstListener;
            }

            /**
             * Handles removal of a hovertip and cleanup tracking.
             * @function destroyHovertip
             * @private
             */
            function destroyHovertip() {
                if (hovertipState.tipRef) {
                    hovertipState.tipRef.destroy();
                }
                hovertipState.tipRef = null;
                hovertipState.tipContent = null;
            }

            // TODO find a better home for this function after grand refactor
            /**
             * Handles a hover event from a layer record.
             * @function hoverHandler
             * @param {Object} hoverParams  object with event parameters
             */
            function hoverHandler(hoverParams) {
                // we use the mouse event target to track which
                // graphic the active tooltip is pointing to.
                // this lets us weed any delayed events that are meant
                // for tooltips that are no longer active.
                const typeMap = {
                    mouseOver: e => {
                        // make the content and display the hovertip
                        const template = `<div class="rv-tooltip-content">
                                <rv-svg once="false" class="rv-tooltip-graphic" src="self.svgcode"></rv-svg>
                                <span class="rv-tooltip-text" ng-bind-html="self.name"></span>
                            </div>`;

                        hovertipState.tipContent = {
                            name: $translate.instant('maptip.hover.label.loading'),
                            svgcode: '<svg></svg>',
                            graphic: e.target
                        };

                        hovertipState.tipRef = tooltipService.addHoverTooltip(e.point, template,
                            hovertipState.tipContent);
                    },
                    tipLoaded: e => {
                        // update the content of the tip with real data.
                        if (hovertipState.tipContent && hovertipState.tipContent.graphic === e.target) {
                            hovertipState.tipContent.name = $filter('picture')(e.name);
                            hovertipState.tipContent.svgcode = e.svgcode;
                        }
                    },
                    mouseOut: e => {
                        // if there is a hovertip bound to what we just moused out of, get rid of it
                        if (hovertipState.tipContent && hovertipState.tipContent.graphic === e.target) {
                            destroyHovertip();
                        }
                    },
                    forceClose: () => {
                        // if there is a hovertip, get rid of it
                        destroyHovertip();
                    }
                };

                // execute function for the given type
                typeMap[hoverParams.type](hoverParams);
            }

            /**
             * Removes the layer from the map and from the layer registry; This will not remove the corresponding legend entry.
             * @function removeLayer
             * @param {Number} layerId  the id of the layer to be removed
             * TODO: needs more work for removing dynamic layers and its children;
             */
            function removeLayer(layerId) {
                const l = layers[layerId];

                // TODO: don't fail silently; throw an error; maybe shown message to the user.
                if (!l) {
                    throw new Error();
                }

                if (l.bbox) {
                    l.destroyBbox(mapObject);
                }

                mapObject.removeLayer(l._layer);
                delete service.layers[layerId]; // remove layer from the registry
            }

            /**
             * Figure out visibility scale and zoom to it.
             * @function zoomToScale
             * @param {Number} layer to zoom to scale to
             * @param {Boolean} zoomIn the zoom to scale direction; true need to zoom in; false need to zoom out
             * @param {Boolean} zoomGraphic an optional value when zoomToScale is use to zoom to a graphic element;
             *                                  true used to zoom to a graphic element; false not used to zoom to a graphic element
             */
            function zoomToScale(layer, zoomIn, zoomGraphic = false) {

                // TODO: remove when all this gets refactored
                // Implementation of "Working Lazy" solution provided by James (issue https://github.com/fgpv-vpgf/fgpv-vpgf/issues/1637)
                if (typeof layer === 'undefined') {
                    return setMapScale({}, geoState.lods[geoState.lods.length - 1], false);
                }

                // if the function is used to zoom to a graphic element and the layer is out of scale we always want
                // the layer to zoom to the maximum scale allowed for the layer. In this case, zoomIn must be
                // always false
                zoomIn = (zoomGraphic) ? false : zoomIn;

                // dynamic layer children don't have the _layerRecord property; set l to parent layer if that's the case
                let topLayer = layer;
                const lods = zoomIn ? geoState.lods : [...geoState.lods].reverse();

                // loop until you find the proper layerRecord in the case of super nested layers
                while (!topLayer._layerRecord) {
                    topLayer = topLayer.parent;
                }

                const l = layers[topLayer.id]._layer;

                // if dynamic layer, must get min/max scale differently (ie. in a promise)
                if (!layer._layerRecord) {
                    return topLayer._layerRecord._attributeBundle[layer.featureIdx].layerData.then(layerData => {
                        const lod = lods.find(currentLod => zoomIn ? currentLod.scale < layerData.minScale
                            : currentLod.scale > layerData.maxScale);

                        // wait for promise to resolve before setting map to proper scale
                        return setMapScale(l, lod, zoomIn);
                    });
                } else {
                    const lod = lods.find(currentLod => zoomIn ? currentLod.scale < l.minScale :
                        currentLod.scale > l.maxScale);
                    return setMapScale(l, lod, zoomIn);
                }
            }

            /**
            * Set map scale depending on zooming in or zooming out of layer visibility scale
            * @param {Object} l layer to zoom to scale to for feature layers; parent layer for dynamic layers
            * @param {Object} lod scale object the map will be set to
            * @param {Boolean} zoomIn the zoom to scale direction; true need to zoom in; false need to zoom out
            */
            function setMapScale(l, lod, zoomIn) {
                // if zoom in is needed; must find center of layer's full extent and perform center&zoom
                if (zoomIn) {
                    // need to reproject in case full extent in a different sr than basemap
                    const gextent = gapiService.gapi.proj.localProjectExtent(l.fullExtent,
                        mapObject.spatialReference);
                    const reprojLayerFullExt = gapiService.gapi.mapManager.Extent(gextent.x0, gextent.y0,
                        gextent.x1, gextent.y1, gextent.sr);

                    // check if current map extent already in layer extent
                    return mapObject.setScale(lod.scale).then(() => {
                        // if map extent not in layer extent, zoom to center of layer extent
                        // don't need to return Deferred otherwise because setScale already resolved here
                        if (!reprojLayerFullExt.intersects(mapObject.extent)) {
                            return mapObject.centerAt(reprojLayerFullExt.getCenter());
                        }
                    });
                } else {
                    return mapObject.setScale(lod.scale);
                }
            }

            /**
            * Zoom to layer boundary of the layer specified by layerId
            * @function zoomToBoundary
            * @param {String} layerId ID of layer entry in the legend
            */
            function zoomToBoundary(layerId) {
                // FIXME: proxy _layer reference
                const l = layers[layerId]._layer;

                let gextent;

                // some user added layers have the fullExtent field, but the properties in it are undefined. Check to see if the fullExtent properties are present
                if (!l.fullExtent.xmin) {
                    gextent = gapiService.gapi.proj.localProjectExtent(
                        gapiService.gapi.proj.graphicsUtils.graphicsExtent(l.graphics),
                        mapObject.spatialReference);
                } else {
                    gextent = gapiService.gapi.proj.localProjectExtent(l.fullExtent,
                        mapObject.spatialReference);
                }

                const reprojLayerFullExt = gapiService.gapi.mapManager.Extent(gextent.x0, gextent.y0,
                    gextent.x1, gextent.y1, gextent.sr);

                return mapObject.setExtent(reprojLayerFullExt);
            }

            /**
             * Reload a layer.  Can accept LayerRecords or LegendEntries.
             * @function reloadLayer
             * @param {LayerRecord|LegendEntry} l the layer to be reloaded
             * @param {Function} configUpdate an optional function which will be passed the configuration
             *                   of the given layer and can make changes before the new layer is loaded
             */
            function reloadLayer(l, configUpdate) {
                // FIXME do a proper test when LegendEntry becomes a proper class
                const lr = l._layerRecord || l;
                const pos = getLayerMapIndex(lr);
                mapObject.removeLayer(lr._layer);
                if (configUpdate) {
                    configUpdate(lr.config);
                }

                l.state = Geo.Layer.States.NEW;
                mapObject.addLayer(lr.constructLayer(), pos);
            }

            /**
             * Switch a feature layer to snapshot mode.
             * @function snapshotLayer
             * @param {LayerRecord|LegendEntry} l the layer to be reloaded
             */
            function snapshotLayer(l) {
                const configUpdate = cfg => cfg.options.snapshot.value = true;
                reloadLayer(l, configUpdate);
            }

            /**
             * Register a LayerRecord object within this service.  Is added the `layers` object internally.
             * Layer IDs must be unique.
             * @function registerLayerRecord
             * @param {LayerRecord} lr
             */
            function registerLayerRecord(lr) {
                if (!lr.layerId) {
                    throw new Error('Attempt to register layer without id property');
                }
                if (layers[lr.layerId]) {
                    throw new Error(`Attempt to register layer already registered.  id: ${lr.layerId}`);
                }
                service.layers[lr.layerId] = lr;
            }

            /**
             * Get the best user-friendly name of a field. Uses alias if alias is defined, else uses the system attribute name.
             * @function aliasedFieldName
             * @param {String} attribName the attribute name we want a nice name for
             * @param {Object} fields array of field definitions. the attribute should belong to the provided set of fields
             */
            function aliasedFieldName(attribName, fields) {
                let fName = attribName;

                // search for aliases
                if (fields) {
                    const attribField = fields.find(field => {
                        return field.name === attribName;
                    });
                    if (attribField && attribField.alias && attribField.alias.length > 0) {
                        fName = attribField.alias;
                    }
                }
                return fName;
            }

            /**
             * Check to see if the attribute in question is an esriFieldTypeDate type.
             * FIXME refactor and move to geoapi
             * @function checkDateType
             * @param {String} attribName the attribute name we want to check if it's a date or not
             * @param {Array} fields array of field definitions. the attribute should belong to the provided set of fields
             * @return {Boolean} returns true or false based on the attribField type being esriFieldTypeDate
             */
            function checkDateType(attribName, fields) {
                if (fields) {
                    const attribField = fields.find(field => {
                        return field.name === attribName;
                    });
                    if (attribField && attribField.type) {
                        return attribField.type === 'esriFieldTypeDate';
                    }
                }
                return false;
            }
        }
    }
})();
