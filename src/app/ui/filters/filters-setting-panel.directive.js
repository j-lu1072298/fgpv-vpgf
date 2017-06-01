const templateUrl = require('./filters-setting-panel.html');

/**
 * @module rvFiltersSettingPanel
 * @memberof app.ui
 * @restrict E
 * @description
 *
 * The `rvFiltersSettingPanel` directive for a filters setting panel.
 *
 */
angular
    .module('app.ui')
    .directive('rvFiltersSettingPanel', rvFiltersSettingPanel);

/**
 * `rvFiltersSettingPanel` directive body.
 *
 * @function rvFiltersSettingPanel
 * @return {object} directive body
 */
function rvFiltersSettingPanel(stateManager, dragulaService, animationService, filterService, $timeout) {
    const directive = {
        restrict: 'E',
        templateUrl,
        scope: { },
        link: link,
        controller: Controller,
        controllerAs: 'self',
        bindToController: true
    };

    return directive;

    function link(scope, directiveElement) {
        const self = scope.self;

        // TODO convert this object into an ES6 class
        // jscs doesn't like enhanced object notation
        // jscs:disable requireSpacesInAnonymousFunctionExpression
        self.dragulaOptions = {

            // only let the user move the item if drag handle is selected
            moves(el, source, handle) {
                // prevent drag from starting if something other than a handle was grabbed
                if (angular.element(handle).parentsUntil(el, '[rv-drag-handle]').length > 0) {
                    return true;
                } else {
                    return false;
                }
            },

            accepts(dragElement, target, source, sibling) {
                // only accepts if there is handle on the sibling (thre is no handle on rvSymbol and rvInteractive)
                // when sibling element is the last one, class gu-mirror is present.
                if (angular.element(sibling).find('[rv-drag-handle]').length > 0 ||
                    sibling.className === 'gu-mirror') {
                    return true;
                } else {
                    return false;
                }
            },

            rvDragDrop() {
                // update datatable order (need to reset before setting back the order, if not order is not set properly)
                const table = filterService.getTable();
                table.colReorder.reset();

                // set a timeout because model needs ot be updated before we reorder the fields
                $timeout(() => {
                    table.colReorder.order(stateManager.display.filters.data.columns.map(item => item.position));
                }, 250);
            }
        };
        // jscs:enable requireSpacesInAnonymousFunctionExpression

        // set an empty animation object in the event a method is called prior
        // to a scroll animation being created
        let scrollAnimation = { pause: () => {}, isActive: () => false };

        // on drag start
        // TODO: abstract the scrolling animation, to avoid code duplication (already in toc.directive)
        scope.$on('filters-bag.drag', (evt, dragElement, source) => {
            // handle autoscroll when dragging layers
            const scrollElem = source.closest('md-content');
            directiveElement.on('mousemove touchmove', event => {

                const pageY = event.pageY ? event.pageY :  event.originalEvent.touches[0].clientY;

                // scroll animation is linear
                let scrollDuration;
                const speedRatio = 1 / 500; // 500 px in 1 second

                // scrolling upwards
                if (scrollElem.offset().top + dragElement.height() > pageY) {
                    scrollDuration = scrollElem.scrollTop() * speedRatio;

                    if (!scrollAnimation.isActive()) {
                        scrollAnimation = animationService.to(scrollElem, scrollDuration,
                            { scrollTo: { y: 0 }, ease: 'Linear.easeNone' });
                    }

                // scrolling downwards
                } else if (scrollElem.height() - pageY <= 0) {
                    if (!scrollAnimation.isActive()) {
                        scrollDuration = (scrollElem[0].scrollHeight -
                            scrollElem.height() - scrollElem.scrollTop()) * speedRatio;

                        scrollAnimation = animationService.to(scrollElem, scrollDuration,
                            { scrollTo: { y: scrollElem[0].scrollHeight - scrollElem.height() },
                                ease: 'Linear.easeNone' });
                    }

                // stop scrolling
                } else {
                    scrollAnimation.pause();
                }
            });
        });

        // on drop, set columns order on stateManager
        scope.$on('filters-bag.drop-model', () => {
            self.dragulaOptions.rvDragDrop();

            // stop and remove autoscroll
            directiveElement.off('mousemove touchmove');
            scrollAnimation.pause();
        });

        // on cancel
        scope.$on('filters-bag.cancel', () => {
            // stop and remove autoscroll
            directiveElement.off('mousemove touchmove');
            scrollAnimation.pause();
        });
    }
}

function Controller($scope, events, filterService, stateManager) {
    'ngInject';
    const self = this;

    self.sort = onSort;
    self.display = onDisplay;
    self.filterService = filterService;

    $scope.$on(events.rvTableReady, () => {
        self.columns = stateManager.display.filters.data.columns;
        $scope.columns = self.columns;

        init();
    });

    /**
     * On table load, initialize sort and display for all columns
     *
     * @function init
     */
    function init() {
        sortColumns();

        // toggle the visibility
        self.columns.forEach(column => {
            if (!column.display) {
                self.filterService.getTable().column(`${column.name}:name`).visible(false);
            }
        });
    }

    /**
     * Sort table from array of sort values (all columns)
     *
     * @function sortColumns
     */
    function sortColumns() {
        // create array of sort from columns
        const sorts = [];
        self.columns.forEach((column, i) => {
            if (typeof column.sort !== 'undefined' && column.sort !== 'none') {
                sorts.push([i, column.sort]);
            }
        });

        // sort columns
        const table = self.filterService.getTable();
        if (sorts.length) {
            table.order(sorts).draw();
        }
    }

    /**
     * On sort click, apply sort value to the column then sort the table
     *
     * @function onSort
     * @param   {Object}   columnInfo   column information
     */
    function onSort(columnInfo) {
        // set sort value on actual column
        const sort = (columnInfo.sort === 'none') ? 'asc' : ((columnInfo.sort === 'asc') ? 'desc' : 'none');
        columnInfo.sort = sort;

        // sort the table
        sortColumns();
    }

    /**
     * On display click, show/hide the column
     *
     * @function onDisplay
     * @param   {Object}   columnInfo   column information
     */
    function onDisplay(columnInfo) {
        // get column
        const column = self.filterService.getTable().column(`${columnInfo.name}:name`);

        // toggle the visibility
        column.visible(columnInfo.display);
    }
}
