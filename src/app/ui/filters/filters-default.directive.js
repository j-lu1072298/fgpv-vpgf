(() => {
    // button blueprints to be added to the table rows
    // `self` property is named so intentionally, as it will be passed on a scope to the ROW_BUTTON_TEMPLATE
    const ROW_BUTTONS = {
        details: {
            name: 'rv-details-marker',
            scope: null,
            self: {
                isFunction: angular.isFunction,
                icon: 'action:description',
                label: 'filter.tooltip.description',
                tooltip: 'filter.tooltip.description',
                action: angular.noop,
                enabled: true
            }
        },
        zoom: {
            name: 'rv-zoom-marker',
            scope: null,
            self: {
                isFunction: angular.isFunction,
                icon: 'action:zoom_in',
                label: zoom => `filter.tooltip.${zoom ? 'zoom' : 'nozoom'}`,
                tooltip: zoom => `filter.tooltip.${zoom ? 'zoom' : 'nozoom'}`,
                action: angular.noop,
                enabled: true
            }
        }
    };

    // jscs:disable maximumLineLength
    // actual button template
    const ROW_BUTTON_TEMPLATE = (row, disabled) =>
        `<md-button
            aria-label="{{ self.isFunction(self.label) ? self.label(self.enabled) : self.label | translate }}"
            class="md-icon-button rv-icon-16 rv-button-24"
            ng-click="self.action(${row})"
            ng-disabled="${disabled}">

            <md-tooltip ng-if="self.tooltip" md-direction="top">{{ self.isFunction(self.tooltip) ? self.tooltip(self.enabled) : self.tooltip | translate }}</md-tooltip>
            <md-icon md-svg-src="{{ self.isFunction(self.icon) ? self.icon(self.enabled) : self.icon }}"></md-icon>

        </md-button>`;
    // jscs:enable maximumLineLength

    // max field length accepted
    const fieldLength = 500;

    // use by keytable on focus event to prevent focus from jumping when keyboard scroll
    let scrollCell = false; // keep the cell info so when pages redraw, it can focus at the right place
    let draw = false; // if there is a scrollCell on table draw we set draw to true so we know draw has been fired by table redraw and we will need to focus to the right row
    let key = false; // false if user use the mouse to scroll and become true if user use arrow keys to navigate

    /**
     * @module rvFiltersDefault
     * @memberof app.ui
     * @description
     *
     * The `rvFiltersDefault` directive is a filters and datatable panel component.
     *
     */
    angular
        .module('app.ui.filters')
        .directive('rvFiltersDefault', rvFiltersDefault);

    /**
     * `rvFiltersDefault` directive displays the datatable with layer data.
     *
     * @function rvFiltersDefault
     * @return {object} directive body
     */
    // jshint maxparams:14
    function rvFiltersDefault($timeout, $q, stateManager, $compile, geoService, $translate,
        layoutService, detailService, $rootElement, $filter, keyNames, filterService, $rootScope, events) {

        const directive = {
            restrict: 'E',
            templateUrl: 'app/ui/filters/filters-default.html',
            scope: {},
            link,
            controller: Controller,
            controllerAs: 'self',
            bindToController: true
        };

        return directive;

        /**
         * Add a `createTable` to self. The table, after creation, is assigned to `self.table`.
         * @function link
         * @param  {Object} scope directive scope
         * @param  {Object} el    node element
         */
        function link(scope, el) { // scope, el, attr, ctrl) {
            const self = scope.self;
            let containerNode;

            self.createTable = createTable;
            self.destroyTable = destroyTable;

            layoutService.panes.filter = el;

            // TODO test to create a div to put the filter panel inside
            // $rootScope.$on(events.rvApiReady, () => {
            //     $('#fgpmap').
            //         after(`<section class="fgpv rv-medium rv-out-filter"
            //             style="display:flex; flex-direction:column; min-height:100vh;"><div id="testfilter"></div></section>`);
            // });
            //
            // $rootScope.$on(events.rvTableReady, () => {
            //     $('#testfilter').append($('rv-panel[type="filters"]'));
            // });

            // columns type with filters information
            const columnTypes = {
                esriFieldTypeString: {
                    init: () => ({ value: '' })
                },
                esriFieldTypeDate: {
                    init: () => ({ min: null, max: null })
                },
                esriFieldTypeSmallInteger: {
                    init: () => ({ min: '', max: '' })
                },
                esriFieldTypeInteger: {
                    init: () => ({ min: '', max: '' })
                },
                esriFieldTypeSingle: {
                    init: () => ({ min: '', max: '' })
                },
                esriFieldTypeDouble: {
                    init: () => ({ min: '', max: '' })
                },
                esriFieldTypeOID: {
                    init: () => ({ min: '', max: '' })
                }
            };

            /**
             * Creates a new datatables instance (destroying existing if any). It pulls the data from the stateManager display store.
             *
             * @function createTable
             * @param {Object} oLang    Translation object for the table
             */
            function createTable(oLang) {
                const callbacks = {
                    onTableDraw,
                    onTableInit,
                    onZoomClick,
                    onDetailsClick,
                    onTableSort,
                    onTableProcess
                };

                // TODO: move hardcoded stuff in consts
                containerNode = containerNode || el.find('.rv-filters-data-container');
                self.destroyTable();

                const requester = stateManager.display.filters.requester;
                const displayData = stateManager.display.filters.data;

                // forced delay of a 100 to prevent the loading indicator from flickering if the table is created too fast; it's annoying; it means that switching tables takes at least 100ms no matter how small the table is; in majority of cases it should take more than 100ms to get data and create a table anyway;
                const forcedDelay = $q(fulfill =>
                    $timeout(() => fulfill(), 100)
                );

                // create a new table node
                const tableNode = angular.element('<table class="display nowrap rv-data-table"></table>');
                containerNode.append(tableNode);

                // disabled zoom row button if projection is not valid
                const isZoomEnabled = geoService.validateProj(
                    geoService.layers[requester.layerId]._layer.spatialReference);
                ROW_BUTTONS.zoom.self.enabled = isZoomEnabled;

                // assign callbacks to row buttons
                ROW_BUTTONS.details.self.action = row => {
                    const currentLayout = layoutService.currentLayout();
                    if (currentLayout === 'small' || currentLayout === 'medium') {
                        onDetailsClick(row, true);
                    } else {
                        onDetailsClick(row);
                    }
                };

                ROW_BUTTONS.zoom.self.action = onZoomClick;

                // make new common scopes for row buttons
                Object.values(ROW_BUTTONS).forEach(button => {
                    const buttonScope = scope.$new(true);
                    buttonScope.self = button.self;

                    if (button.name === 'rv-zoom-marker') {
                        // disabled zoom button if layer is not visible
                        buttonScope.self.visibility = requester.legendEntry.options.visibility;
                    }

                    button.scope = buttonScope;
                });

                // add the column interactive buttons renderer
                addColumnInteractivity();

                // returns array of column indexes we want in the CSV export
                // are not the symbol or interactive column.
                const exportColumns = (columns) => {
                    // map columns to their ordinal indexes. but mark the symbol and interactive column as -1.
                    // then filter out the -1. result is an array of column indexes that

                    // are not the symbol and interactive columns.
                    return columns
                        .map((column, i) => (column.data === 'rvInteractive' || column.data === 'rvSymbol') ? -1 : i)

                        .filter(idx => idx > -1);
                };

                // returns array of column info where .data field has any period characters escaped
                const escapedColumns = (columns) => {
                    // deep copy so we don't change the displayData.columns array.
                    // that array is used in other places, and messing with it will
                    // break things.
                    const copyArray = angular.copy(columns);
                    copyArray.forEach(column => {
                        column.data = column.data.replace(/\./g, '\\.');
                    });
                    return copyArray;
                };

                // set width from field length if it is a string field type. If it is the oid field,
                // set width to 100px because we have the oid, the details and zoom to button. If it is
                // another type of field, set width to be the title.
                displayData.columns.forEach((column, index) => {
                    const field = displayData.fields.find(field => field.name === column.data);

                    if (typeof field !== 'undefined') {
                        // set position if not defined
                        if (column.position === -1) { column.position = index; }

                        // set filter and column initial values if not initialize
                        if (!column.filter.init) {
                            column.filter = columnTypes[field.type].init();
                            column.filter.init = true;

                            if (field.type === 'esriFieldTypeString') {
                                const width = getColumnWidth(column.title, field.length, 250);
                                column.width = `${width}px`;
                                column.render = renderEllipsis(width);
                            } else if (field.type === 'esriFieldTypeOID') {
                                // set column to be 100px width because of details and zoom to buttons
                                column.width = '100px';
                            } else if (field.type === 'esriFieldTypeDate') {
                                // convert each date cell to a better format
                                displayData.rows.forEach(r => r[field.name] = $filter('dateTimeZone')(r[field.name]));
                                const width = getColumnWidth(column.title, 0, 400, 375);
                                column.width =  `${width}px`;
                            } else {
                                const width = getColumnWidth(column.title, 0, 250, 120);
                                column.width = `${width}px`;
                                column.render = renderEllipsis(width);
                            }
                        }
                    }
                });

                // ~~I hate DataTables~~ Datatables are cool!
                self.table = tableNode
                    .on('init.dt', callbacks.onTableInit)
                    .on('draw.dt', callbacks.onTableDraw)
                    .on('order.dt', callbacks.onTableSort)
                    .on('processing.dt', callbacks.onTableProcess)
                    .DataTable({
                        dom: 'rti',
                        columns: escapedColumns(displayData.columns),
                        data: displayData.rows,
                        order: [],
                        deferRender: true,
                        processing: true, // show processing when filtering takes time
                        scrollY: true, // allow vertical scroller
                        scrollX: true, // allow horizontal scroller
                        // need to remove because we can have autoWidth and fix columns at the same time (if so, columns are note well displayed)
                        autoWidth: false, // without autoWidth, few columns will be stretched to fill avaialbe width, and many columns will cause the table to scroll horizontally
                        scroller: {
                            displayBuffer: 10 // we tend to have fat tables which are hard to draw -> use small buffer https://datatables.net/reference/option/scroller.displayBuffer.
                            // see key-focus event to see why we put 10
                        }, // turn on virtual scroller extension
                        keys: {
                            keys: [keyNames.LEFT_ARROW, keyNames.UP_ARROW, keyNames.RIGHT_ARROW, keyNames.DOWN_ARROW], // only navigate with arrow key
                            className: 'rv-cell-focus'
                        }, // turn on keytable extension
                        colReorder: {
                            fixedColumnsLeft: 2, // fix symbol and interactive columns
                            realtime: false// we need this to know when reorder is done
                        }, // turn on colReorder extension
                        /*select: true,*/ // allow row select,
                        buttons: [
                            // 'excelHtml5',
                            // 'pdfHtml5',
                            {
                                extend: 'print',
                                title: self.display.requester.name,
                                exportOptions: {
                                    columns: exportColumns(displayData.columns)
                                }
                            },
                            {
                                extend: 'csvHtml5',
                                title: self.display.requester.name,
                                exportOptions: {
                                    columns: exportColumns(displayData.columns)
                                }
                            }
                        ],
                        oLanguage: oLang
                    });

                /**
                 * Get column width from column title and field length.
                 * @function getColumnWidth
                 * @private
                 * @param {Object} title    column title
                 * @param {Interger} length   optional column length (characters)
                 * @param {Integer}  maxLength   optional maximum column length (pixels)
                 * @param {Integer}  minLength   optional minimum column length (pixels)
                 * @return {Number} width    width of the column
                 */
                function getColumnWidth(title, length = 0, maxLength = 200, minLength = 50) {
                    // get title length (minimum 50px)
                    let metricsTitle = getTextWidth(title);
                    metricsTitle = metricsTitle < minLength ? minLength : metricsTitle;

                    // get column length (only type string have length)
                    if (length) {
                        // some layer like http://section917.cloudapp.net/arcgis/rest/services/EcoGeo/MapServer/6
                        // can have length = 2147483647 and it make the function crash
                        length = (length < fieldLength) ? length : fieldLength;

                        // generate a string with that much characters and get width
                        let metricsContent = getTextWidth(Array(length).join('x'));

                        // set the column length from field length (maximum will be maxLength)
                        metricsContent = metricsContent <= maxLength ? metricsContent : maxLength;

                        // check if it is lower then title length. If so, use title length
                        metricsTitle = metricsContent < metricsTitle ? metricsTitle : metricsContent;
                    }

                    return metricsTitle;
                }

                /**
                 * Render long text width ellipsis (https://datatables.net/blog/2016-02-26)
                 * @function RenderEllipsis
                 * @private
                 * @param {Object} width    column width
                 * @return {String} text    text for td element or string who contain html element
                 */
                function renderEllipsis(width) {
                    const esc = (text) => {
                        return text
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;');
                    };

                    return (text, type) => {
                        // order, search and type get the original data
                        if (type !== 'display') {
                            return text;
                        }

                        if (typeof text !== 'number' && typeof text !== 'string') {
                            return text;
                        }

                        text = text.toString(); // cast numbers

                        // if text width smaller then column width, return text
                        if (getTextWidth(text) < width) {
                            return text;
                        }

                        // for wcag we add a span element with a tooltip. With keytable extension, when this cell get focus
                        // This element will be visible.
                        return `<span class="rv-render-ellipsis" title="${esc(text)}">${esc(text)}</span>
                                <span class="rv-render-tooltip">${esc(text)}</span>`;
                    };
                }

                /**
                 * Get text width (http://stackoverflow.com/questions/118241/calculate-text-width-with-javascript)
                 * @function getTextWidth
                 * @private
                 * @param {String} input    text ot calculate width from
                 * @return {Number} width    text width
                 */
                function getTextWidth(input) {
                    // re-use canvas object for better performance
                    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement('canvas'));
                    const context = canvas.getContext('2d');
                    context.font = '14px Roboto';

                    return context.measureText(input).width;
                }

                /**
                 * Table initialization callback. This will hide the loading indicator.
                 * @function onTableInit
                 * @private
                 */
                function onTableInit() {
                    // turn off loading indicator after the table initialized or the forced delay whichever takes longer; cancel loading timeout as well
                    forcedDelay.then(() => {
                        // TODO: these ought to be moved to a helper function in displayManager
                        stateManager.display.filters.isLoading = false;
                        $timeout.cancel(stateManager.display.filters.loadingTimeout);

                        // set colReorder extension
                        setColumnReorder();

                        // set keytable extension
                        setkeytable();

                        // set the ignore-focus only on the body. If not, header are not focusable and we can't go to the table with the keyboard
                        // TODO: in 1.6 when we add the filters we will need a way to go to setting panel (skip the table)
                        layoutService.panes.filter.find('.dataTables_scrollBody').attr('rv-ignore-focusout', '');

                        // initialize a temporary array to store all the custom filters so they don't fire every time we add new one
                        $.fn.dataTable.ext.searchTemp = [];

                        // set active table so it can be accessed in filter-search.directive for global table search
                        filterService.setTable(self.table, displayData.filter.globalSearch);

                        // recalculate scroller space on table init because if the preopen table was maximized in setting view
                        // the scroller is still in split view
                        self.table.scroller.measure();

                        // fired event to create filters
                        $rootScope.$broadcast(events.rvTableReady);
                    });
                }

                /**
                 * Table draw callback. This will replace row placeholder button with real angular directives.
                 * @function onTableDraw
                 * @private
                 */
                function onTableDraw() {
                    console.log('rows are drawn');

                    // draw has been fired because of scrolling with the keyboard
                    if (scrollCell) { draw = true; }

                    // hide processing display on redraw
                    $rootElement.find('.dataTables_processing').css('display', 'none');

                    // find all the button placeholders
                    Object.values(ROW_BUTTONS).forEach(button => {

                        // set the disabled argument value
                        button.disabledArg = (button.name === 'rv-zoom-marker') ?
                            '!self.enabled || !self.visibility.value' : '';

                        // and replace when with properly compiled directives
                        tableNode.find(button.name).each((index, item) => {
                            item = angular.element(item);
                            const row = item.attr('row'); // get the row number of the button

                            const template = ROW_BUTTON_TEMPLATE(row, button.disabledArg);
                            const rowButtonDirective =  $compile(template)(button.scope);

                            item.replaceWith(rowButtonDirective);
                        });
                    });
                }

                /**
                 * Initialize the colReorder extenstion events to reorder stateManager on when columns reorder
                 * @function setColumnReorder
                 * @private
                 */
                function setColumnReorder() {
                    self.table.on('column-reorder', (e, settings, details) => {
                        // only reorder columns if modificattion have been made on the table itself
                        // from the setting panel, we have another to deal with it
                        if (!filterService.isSettingOpen) {
                            // reorder columns in statemanager to preserve the order
                            // remove the moved element then add a it back at the right place
                            const item = stateManager.display.filters.data.columns.splice(details.from, 1)[0];
                            stateManager.display.filters.data.columns.splice(details.to, 0, item);

                            // blur the focus cell and reset scrollCell
                            self.table.cell.blur();
                            scrollCell = false;

                            // redraw table to put back interactive column (the wrapper gets empty after a column reorder)
                            self.table.draw();
                        }
                    });
                }

                /**
                 * Initialize the keyTable extenstion who let navigate the datatables like Excel spread sheet
                 * @function setkeytable
                 * @private
                 */
                function setkeytable() {
                    // DOMMouseScroll (FF), mousewheel (Chrome, Safari and IE)
                    layoutService.panes.filter.find('.dataTables_scrollBody').on('mousewheel DOMMouseScroll', () => {
                        // if key is true it means user was using keyboard to navigate datatable so blur the focus
                        // so datatables doesn't try to put back the focus where it was
                        // then set user doesn't use keyboard navigation
                        if (key) { self.table.cell.blur(); }
                        key = false;
                    });

                    // focus on close button when table open (wcag requirement)
                    // at the same time it solve a problem because when focus is on menu button, even if focus is on the
                    // table cell it goes inside the menu and loop through it at the same time as we navigate the table
                    $timeout(() => { $rootElement.find('[type=\'filters\'] button.rv-close').focus(true); }, 250);

                    // when we navigate with the keyboard, the scroller extension has buffer items in memory. Without this
                    // workaround, the keyboard can only navigate inside those items.
                    self.table.on('key-focus', (e, datatable, cell) => {
                        // known issue: Uncaught TypeError: Cannot read property 'top' of undefine at KeyTable._scroll (core.js:47509)
                        //              Uncaught TypeError: Cannot read property 'row' of undefined at KeyTable._focus (core.js:47367)
                        // when we scroll a lot of rows in one shot, datatables information is not updated well and keytable is not able to find where it should go
                        // so it throws an error. The only way to solve this is to close then reopen the table
                        // to solve/minimize the problem scroller displayBuffer has been increase from 3 to 10

                        // there is a side effect when we mix mouse and keyboard. After a mouse scroll when we start to reuse the
                        // keyboard the scroll jump to show the selected item at the second row.
                        const info = datatable.scroller.page();
                        const cellInfo = cell.index();

                        // if there is a button inside the node, focus to it so keyboard user can interact with it
                        // pressing tab will focus the next button
                        const node = $(cell.node()).find('button');
                        if (node.length > 0) { node.first().focus(true); }

                        // do not shift focus if scrollCell is false (sort will set scrollCell to false to avoid focus shifting)
                        if (!key || !draw && scrollCell) {
                            // need to scroll where the focus is (if outside the visible items). It is not always done automatically
                            // keep the cell in memory so when there is a draw, we can put back the focus at the right place
                            scrollCell = cell;
                            if (cellInfo.row < info.start || cellInfo.row >= info.end) {
                                self.table.row(cellInfo.row - 1).scrollTo(false); // false because we doesn't want animation
                            }
                        } else if (draw) {
                            // when the rows are drawn, it shift the focus for the active cell. Need to put it back with
                            // the value in memory
                            // after the draw, datatable.scroller.page() info are wrong so we can't use them to know if we are
                            // in the visible area
                            const focusRow = scrollCell[0][0].row;
                            self.table.cell(focusRow, cellInfo.column).focus();
                            self.table.row(focusRow - 1).scrollTo(false); // false because we doesn't want animation
                            draw = false;
                            scrollCell = false;
                        }

                        // user is using keyboard navigation
                        key = true;
                    });
                }

                /**
                 * Table sort callback. This will update the sort columns so setting panel and table can be synchronize
                 * @function onTableSort
                 * @private
                 */
                function onTableSort(e, settings) {
                    // reset sort values
                    stateManager.display.filters.data.columns.forEach(item => item.sort = 'none');

                    // update sort column from the last sort, use value from statemanager because interactive column may have been added
                    settings.aLastSort.forEach(item => {
                        stateManager.display.filters.data.columns[item.col].sort = item.dir;
                    });

                    // reset scrollCell because table has been sort, we dont want the focus to shift
                    scrollCell = false;
                }

                /**
                 * Table processing callback. This will show processing notice when table process (mainly use when sort)
                 * @function onTableProcess
                 * @private
                 */
                function onTableProcess(e, settings, processing) {
                    $rootElement.find('#processingIndicator').css('display', processing ? 'block' : 'none');
                }

                /**
                 * Row zoom click handler. Will zoom to the feature clicked.
                 * @function onZoomClick
                 * @private
                 * @param  {Number} rowNumber number of the row clicked
                 */
                function onZoomClick(rowNumber) {
                    const data = self.table.row(rowNumber).data();

                    // get object id from row data
                    const objId = data[displayData.oidField];
                    const layer = geoService.layers[requester.layerId];
                    const zoomLayer = requester.legendEntry;
                    const filterPanel = $rootElement.find('rv-panel[type="filters"]');
                    const otherPanels = $rootElement.find('rv-appbar, rv-mapnav, rv-panel:not([type="filters"])');
                    let ignoreClick = true;

                    geoService.zoomToGraphic(layer, zoomLayer, requester.legendEntry.featureIdx, objId);

                    const removeZoomtoTransparency = () => {
                        otherPanels.removeClass('rv-lt-lg-hide');
                        filterPanel.removeClass('zoomto-transparent');
                        filterPanel.off('.zoomTO');
                        $(window).off('.zoomTo');
                    };

                    otherPanels.addClass('rv-lt-lg-hide');
                    filterPanel.addClass('zoomto-transparent');

                    filterPanel.on('click.zoomTO mousedown.zoomTO touchstart.zoomTO', () =>
                        ignoreClick ? ignoreClick = false : removeZoomtoTransparency()
                    );

                    // ensures that resizing from sm/md to lg and back does not persist transparency
                    $(window).on('resize.zoomTO', () =>
                        layoutService.currentLayout() === 'large' ? removeZoomtoTransparency() : undefined
                    );
                }

                /**
                 * Row details click handler. Will display details for the feature clicked.
                 * @function onDetailsClick
                 * @private
                 * @param  {Number} rowNumber number of the row clicked
                 */
                function onDetailsClick(rowNumber, useDialog = false) {
                    const data = self.table.row(rowNumber).data();
                    const layerRec = geoService.layers[requester.layerId];

                    // get object id from row data
                    const objId = data[displayData.oidField];

                    // faking an object that looks like it was generated by the identify module
                    // TODO use of _layerRecord should probably be changed to not use a private var
                    // TODO: check if the previous todo is no longer valid
                    const detailsObj = {
                        isLoading: false,
                        data: [
                            {
                                name: geoService.getFeatureName(data, layerRec, objId),
                                data: geoService.attributesToDetails(data, displayData.fields),
                                oid: objId,
                                symbology: [
                                    { svgcode: data.rvSymbol }
                                ]
                            }
                        ],
                        requestId: -1,
                        requester: {
                            format: 'EsriFeature',
                            name: requester.name,
                            featureIdx: requester.legendEntry.featureIdx,
                            layerRec
                        }
                    };

                    const details = {
                        data: [detailsObj]
                    };

                    if (useDialog) {
                        stateManager.display.details.selectedItem = detailsObj;
                        detailService.expandPanel(false);
                    } else {
                        stateManager.toggleDisplayPanel('mainDetails', details, {}, 0);
                    }

                    const layer = geoService.layers[requester.layerId];
                    geoService.hilightGraphic(layer, requester.legendEntry.featureIdx, objId);
                }

                /**
                 * Adds zoom and details renderer to rvInteractive column.
                 * @function addColumnInteractivity
                 */
                function addColumnInteractivity() {
                    // use render function to augment button to displayed data when the table is rendered

                    // we have to do some horrible string manipulations because Datatables required the `render` function to return a string
                    // it's not possble to return a compiled directive from the `render` function since directives compile directly into dom nodes
                    // first, button placeholder nodes are rendered as part of the cell data
                    // then, on `draw.dt`, these placeholders are replaced with proper compiled button directives
                    const interactiveColumnExist = displayData.columns.find(column =>
                        column.data === 'rvInteractive');

                    interactiveColumnExist.render =  (data, type, row, meta) => {
                        const buttonPlaceholdersTemplate = Object.values(ROW_BUTTONS).map(button =>
                            `<${button.name} row="${meta.row}"></${button.name}>`)
                            .join('');
                        return `<div class="rv-wrapper">${buttonPlaceholdersTemplate}</div>`;
                    };
                }
            }

            /**
             * Destroys the table and its node if it exists.
             * @function destroyTable
             */
            function destroyTable() {
                if (self.table) {
                    // destroy table with all events
                    self.table.destroy(true); // https://datatables.net/reference/api/destroy()
                    delete self.table; // kill the reference

                    // clear hilight when table closes or new table is opened
                    // TODO verify this is the proper location for this line
                    geoService.clearHilight();

                    // reinitialize to false when table is destroyed
                    scrollCell = false;
                    draw = false;
                    key = false;
                }
            }
        }
    }

    /**
     * Controller watches for panel morph changes and redraws the table after the change is complete;
     * it also watches for dispaly data changes and re-creates the table when it does change.
     * @function Controller
     */
    function Controller($rootScope, $scope, $timeout, $translate, tocService, stateManager, events, filterService,
        configService, appInfo) {
        'ngInject';
        const self = this;

        self.display = stateManager.display.filters;
        self.appID = appInfo.id;

        self.filterService = filterService;

        self.draw = draw;

        const languageObjects = {};

        let isFullyOpen = false; // flag inicating that filters panel fully opened
        let deferredAction = null; // deferred function to create a table

        activate();

        function activate() {
            // wait for morph on filters panel to complete and redraw the datatable
            $scope.$on('stateChangeComplete', (event, name, property, value) => { // , skip) => {
                if (name === 'filters') {
                    console.log('Filters: ', event, name, property, value); // , skip);
                    self.draw(value);

                    if (property === 'active') {
                        isFullyOpen = value;

                        if (value && deferredAction) { // if fully opened and table creation was deferred, call it
                            deferredAction();
                            deferredAction = null;
                        }
                    }
                }
            });

            // watch filterService onCreate to make a new table
            $scope.$watch(() => filterService.filterTimeStamps.onCreated, val => {
                if (val !== null) {
                    if (isFullyOpen) {
                        self.createTable(getDToLang());
                    } else {
                        // we have to deferr table creating until after the panel fully opens, we if try to create the table while the animation is in progress, it freezes as all calculations that Datatables is doing blocks ui;
                        // this means when the panel first opens, it will take 300ms longer to display any table then upon subsequent table creation when the panel is already open and the user just switches between layers;
                        deferredAction = () => self.createTable(getDToLang());
                    }
                }
            });

            $scope.$watch(() => filterService.filterTimeStamps.onDeleted, val => {
                if (val !== null) {
                    self.destroyTable();

                    // when table is close, set isSettingOpen to false to make sure table always open visible
                    // Table need to be displayed to initialize columns width properly. Setting visibility hidden doesn't work for FF and Safari
                    // we can't recalculate with columns.adjust() because we loose the predefine width
                    self.filterService.isSettingOpen = false;

                    // clear all filters from datatables api (number and date). They are global for all tables and we recreate table every time so
                    // there is no other way to reuse them later
                    $.fn.dataTable.ext.search.splice(0, $.fn.dataTable.ext.search.length);
                }
            });

            $scope.$watch(() => filterService.filterTimeStamps.onChanged, val => {
                if (val !== null) {
                    self.table.draw();
                }
            });

            // wait for print event and print the table
            $scope.$on(events.rvDataPrint, () => {
                console.log('Printing Datatable');

                triggerTableButton(0);
            });

            // wait for data export CSV event and export
            $scope.$on(events.rvDataExportCSV, () => {
                console.log('Exporting CSV Datatable');

                triggerTableButton(1);
            });

            // load language object on language switch
            $rootScope.$on('$translateChangeSuccess', () => {
                if (self.table) {
                    // to manage language switch on DataTable
                    setDToLang();
                    // catch translation done signal
                    self.table.draw();
                }
            });

            /**
             * Set language for table
             *
             * @function setDToLang
             * @private
             */
            function setDToLang() {

                const newLang = getDToLang();
                let oLang = self.table.context[0].oLanguage;

                angular.merge(oLang, newLang);

                return oLang;
            }

            /**
             * Return translated table language object
             *
             * @function getDToLang
             * @private
             * @returns {Object}    Object containing all translated strings for the datatable
             */
            function getDToLang() {
                const lang = $translate.proposedLanguage() || $translate.use();
                if (languageObjects[lang]) {
                    return languageObjects[lang];
                }

                const oLangSrc = {
                    sProcessing: 'processing',
                    sSearch: 'search',
                    sLengthMenu: 'length.menu',
                    sInfo: 'info',
                    sInfoEmpty: 'zero',
                    sInfoFiltered: 'filtered',
                    sInfoPostFix: 'postfix',
                    sLoadingRecords: 'loadrec',
                    sZeroRecords: 'zerorecords',
                    sEmptyTable: 'emptytable'
                };
                const oPaginateSrc = {
                    sFirst: 'first',
                    sPrevious: 'previous',
                    sNext: 'next',
                    sLast: 'last'
                };
                const oAriaSrc = {
                    sSortAscending: 'sortasc',
                    sSortDescending: 'sortdsc'
                };
                const oLang = { oPaginate: {}, oAria: {} };
                Object.keys(oLangSrc).forEach(key =>
                    oLang[key] = $translate.instant(`filter.default.label.${oLangSrc[key]}`));
                Object.keys(oPaginateSrc).forEach(key =>
                    oLang.oPaginate[key] = $translate.instant(`filter.default.label.${oPaginateSrc[key]}`));
                Object.keys(oAriaSrc).forEach(key =>
                    oLang.oAria[key] = $translate.instant(`filter.default.aria.${oAriaSrc[key]}`));

                languageObjects[lang] = oLang;

                return languageObjects[lang];
            }
        }

        // redraw the table using scroller extension
        function draw(value) {
            if (self.table) {
                console.log('Filters: drawing table');

                const scroll = self.table.scroller;
                if (value === 'default') {
                    // if scroll down to the bottom of the datatable and switch view from full to default,
                    // scroller.measure() creates blank out when redraw, set measure argument to false
                    scroll.measure(false);

                    // because of no redraw datatable info does not update, set info manually
                    // set index to make sure it works for French and English translation
                    // TODO: make it work when new language is added
                    const info = self.table.table().container().getElementsByClassName('dataTables_info')[0];
                    const infos = info.innerText.split(' ');
                    const index = (configService.currentLang() === 'en-CA') ? 1 : 3;
                    infos[index] = scroll.page().start + 1;
                    infos[index + 2] = scroll.page().end + 1;
                    info.innerText = infos.join(' ');
                } else if (value === 'full') {
                    // if scroll down to the bottom of the datatable, then up a little bit and switch view from default to full,
                    // scroller.measure(false) creates blank out when redraw, set measure argument to true
                    scroll.measure(true);
                }

                // self.table.columns.adjust().draw();
            }
        }

        /**
         * Triggers a button on the table with the specified index
         * @function triggerTableButton
         * @param  {Number|String} index button selector: https://datatables.net/reference/api/button()
         */
        function triggerTableButton(index) {
            // see `buttons` array in the DataTable constructor object in the directive above
            const button = self.table.button(index);
            if (button) {
                button.trigger();
            }
        }
    }
})();
