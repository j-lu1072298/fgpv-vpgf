(() => {
    'use strict';

    /**
     * @module rvLightbox
     * @module app.ui
     * @restrict A
     * @description
     *
     * The `rvLightbox` directive creates the lightbox control
     *
     */
    angular
        .module('app.ui.lightbox')
        .directive('rvLightbox', rvLightbox);

    function rvLightbox($mdDialog, storageService) {
        const directive = {
            restrict: 'A',
            scope: '=',
            link: link
        };

        return directive;

        /*********/

        function link(scope, element) {

            element.on('click', (event) => {
                // prevent the link from opening
                event.preventDefault(true);
                event.stopPropagation(true);

                const imgs = element.find('img');

                if (imgs.length > 0) {
                    const images = [];
                    imgs.each((index) => { images.push(imgs[index].src); });

                    $mdDialog.show({
                        controller: LightboxController,
                        parent: storageService.panels.shell,
                        locals: {
                            items: { images }
                        },
                        templateUrl: 'app/ui/lightbox/lightbox.html',
                        clickOutsideToClose: true,
                        disableParentScroll: false,
                        escapeToClose: true,
                        controllerAs: 'self',
                        bindToController: true,
                        hasBackdrop: true
                    });
                }
            });
        }

        function LightboxController(items, keyNames) {
            'ngInject';
            const self = this;

            self.close = $mdDialog.hide;
            self.index = 0;
            self.images = items.images;
            self.length = self.images.length;
            self.currImage = self.images[self.index];

            self.previous = clickPrevious;
            self.next = clickNext;
            self.loopImages = loopImages;

            function loopImages(event) {
                if (event.keyCode === keyNames.LEFT_ARROW) {
                    clickPrevious();
                } else if (event.keyCode === keyNames.RIGHT_ARROW) {
                    clickNext();
                }
            }

            function clickPrevious() {
                console.log('previous');
            }

            function clickNext() {
                console.log('next: ' + self.length);
            }
        }

    }
})();
