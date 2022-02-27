'use strict';

var Collection = (function() {

  function Collection(config) {
    var defaults = {
      'onLoadEnd': function(){ console.log('Loading finished'); },
      'onLoadProgress': function(){ console.log('Loading progress...') },
      'zoomInDistance': 30, // how far away camera should be when it zooms into an item
      "menuContainer": "#menus-container",
      'seedString': 'museum' // seed for randomizing positions
    };
    this.opt = _.extend({}, defaults, config);
    this.init();
  }

  Collection.prototype.init = function(){
    this.camera = this.opt.camera;
    this.listener = this.opt.listener;
    this.controls = false;
    this.currentViewKey = 'randomSphere';
    this.isViewTransitioning = false;
    this.minAlpha = this.opt.ui.minAlpha;
    this.$el = $(this.opt.el);
    this.onChangeViewFinished = false;

    this.ui = this.opt.ui;

    this.itemManager = new ItemDetailManager(this.opt.metadata);
    this.storyManager = new StoryManager({"stories": this.opt.stories});

    var views = this.opt.views;
    var i = 0;
    _.each(views, function(view, key){
      views[key].key = key;
      views[key].index = key;
      i += 1;
    })
    this.views = views;

    this.labelSets = {};
    this.overlays = [];
    this.soundSets = {};
  };

  Collection.prototype.changeView = function(key, onFinished){
    if (key == this.currentViewKey) return true;

    if (!_.has(this.views, key) || !this.$viewOptions || !this.$viewOptions.length || this.isViewTransitioning) return false;

    var $input = $('.view-option[value="'+key+'"]');
    if (!$input.length) return false;

    var viewIndex = parseInt($input.attr('data-index'));

    this.$viewOptions.eq(viewIndex).prop('checked', true);
    this.$viewOptions.eq(viewIndex).focus();

    if (onFinished) this.onChangeViewFinished = onFinished;
    this.onViewOptionChange(this.$viewOptions.eq(viewIndex));

    return true;
  };

  Collection.prototype.deselectActiveItem = function(onFinished){
    if (this.itemManager.itemIndex < 0 || this.itemManager.itemIndex===false) {
      onFinished && onFinished();
      return;
    };
    var flyToLastPosition = true;
    this.controls && this.controls.releaseAnchor(flyToLastPosition, onFinished);
    var itemIndex = this.itemManager.releaseSelectedItem();
    this.updateItemAlpha(itemIndex, 1, 10); // show the current item
  };

  Collection.prototype.filterBySet = function(setKey, transitionDuration){
    transitionDuration = transitionDuration || this.opt.ui.transitionDuration;
    var sets = this.opt.sets;
    if (!_.has(sets, setKey)) {
      console.log('No set key found in sets:'+setKey)
      return;
    }

    var indices = sets[setKey].values;
    var _this = this;
    var toAlphaValues = new Float32Array(this.metadata.itemCount);
    _.times(this.metadata.itemCount, function(i){
      toAlphaValues[i] = _this.minAlpha;
    });
    _.each(indices, function(index, i){
      toAlphaValues[index] = 1.0;
    })
    this.updateAlpha(false, toAlphaValues, transitionDuration);
  };

  Collection.prototype.getCurrentItemIndex = function(){
    var index = -1;
    if (this.itemManager) index = this.itemManager.itemIndex;
    if (index === false || index === undefined) index = -1;
    return index;
  };

  Collection.prototype.getCurrentView = function(key){
    key = key || this.currentViewKey;
    var view = _.has(this.views, key) ? this.views[key] : this.views[_.first(_.keys(this.views))];
    return view;
  };

  Collection.prototype.getDefaultCameraPosition = function(key){
    key = key || this.currentViewKey;
    var view = this.views[key];

    if (!view || !_.has(view, 'cameraPosition')) {
      console.log('Warning: No camera position for '+key);
      return (new THREE.Vector3(0,0,0));
    }

    var p = view.cameraPosition;
    return (new THREE.Vector3(p[0], p[1], p[2]));
  };

  Collection.prototype.getThree = function(){
    return this.container;
  };

  Collection.prototype.getTotalToLoad = function(){
    var totalToLoad = 1; // load metadata
    // load positions
    totalToLoad += _.keys(this.opt.positions).length;
    // load sets
    totalToLoad += _.keys(this.opt.sets).length;
    // load textures
    totalToLoad += _.reduce(this.opt.textures, function(memo, t){ return memo + t.assets.length; }, 0);
    // load labels
    totalToLoad += _.keys(this.opt.labels).length;
    // load overlays
    totalToLoad += _.reduce(this.views, function(memo, view){
      if (_.has(view, 'overlays')) return memo + view.overlays.length;
      else return memo;
    }, 0);
    // load sounds
    // totalToLoad += _.keys(this.opt.sounds).length;
    return totalToLoad;
  };

  Collection.prototype.jumpToStory = function(storyId){
    if (!this.controls) return;
    var currentView = this.views[this.currentViewKey];

    var story = this.storyManager.stories[storyId];
    if (!story || !story.hotspot || !story.hotspot.object) return;

    var currentPosition = this.camera.position.clone();
    var targetLookAtPosition = story.hotspot.object.position.clone();
    var targetPosition = currentPosition.clone();
    var transitionDuration = this.opt.ui.transitionDuration;

    var xMin = currentView.bounds[0];
    var xMax = currentView.bounds[1];
    var zMin = currentView.bounds[2];
    var zMax = currentView.bounds[3];
    var zDelta = Math.min((zMax - zMin) * 0.25, 1500);
    targetPosition.z = targetLookAtPosition.z - zDelta;
    targetPosition.x = MathUtil.clamp(targetLookAtPosition.x, xMin, xMax);
    targetLookAtPosition.y = this.controls.lookAtPosition.y;

    targetLookAtPosition = false; // don't lock it in for now
    this.controls.flyTo(targetPosition, targetLookAtPosition, transitionDuration);
  };

  Collection.prototype.jumpToTime = function(year){
    var currentView = this.views[this.currentViewKey];

    if (!currentView.yearRange) return;

    var bounds = currentView.bounds;
    var minYear = currentView.yearRange[0];
    var maxYear = currentView.yearRange[1];
    var t = MathUtil.norm(year, minYear, maxYear);

    var originPosition = this.camera.position.clone();
    var targetPosition = originPosition.clone();
    targetPosition.z = MathUtil.lerp(bounds[2], bounds[3], t);

    var distance = originPosition.distanceTo(targetPosition);
    var unitsPerSecond = 1000;
    var duration = parseInt(distance / unitsPerSecond * 1000);

    var targetLookAtPosition = false;
    this.controls.flyTo(targetPosition, targetLookAtPosition, duration);
  };

  Collection.prototype.load = function(){
    var _this = this;

    this.loadKeys();
    this.loadMenus();

    $.when(
      this.loadLabels(),
      this.loadMetadata(),
      this.loadOverlays(),
      this.loadPositions(),
      this.loadSets(),
      // this.loadSounds(),
      this.loadTextures()

    ).done(function(){
      _this.onReady();
      _this.opt.onLoadEnd();
    });
  };

  Collection.prototype.loadKeys = function(){
    var _this = this;
    var keys = {};
    _.each(this.opt.keys, function(keyOptions, keyValue){
      var key = new Key(_.extend({id: keyValue}, keyOptions, {camera: _this.camera}));
      keys[keyValue] = key;
    });

    this.keys = keys;
  };

  Collection.prototype.loadLabels = function(){
    var _this = this;
    var fontFiles = {
      'default': LabelSet.defaultValues.fontDir + LabelSet.defaultValues.fontFile
    };
    _.each(this.opt.labels, function(set, key){
      if (_.has(set, 'fontFile') && set.fontFile != LabelSet.defaultValues.fontFile && !_.has(fontFiles, set.fontFile)) {
        fontFiles[set.fontFile] = LabelSet.defaultValues.fontDir + set.fontFile;
      }
    });
    var fontPromises = [];
    var loader = new THREE.FontLoader();
    _.each(fontFiles, function(fontPath, key){
      var deferred = $.Deferred();
      loader.load(fontPath, function(response) {
        console.log('Loaded '+fontPath);
        fontFiles[key] = response;
        deferred.resolve();
      });
      fontPromises.push(deferred);
    });

    var deferred = $.Deferred();
    var views = this.views;
    var labelSets = {};
    $.when.apply(null, fontPromises).done(function() {
      console.log('Loaded font files');

      var labelPromises = [];
      _.each(_this.opt.labels, function(set, key){
        var labelPromise = $.Deferred();
        // pass in width/height/depth of default view
        if (_.has(set, 'defaultView') && _.has(views, set.defaultView)) {
          set = _.extend({}, set, _.pick(views[set.defaultView], 'width', 'height', 'depth'));
        }
        // add the loaded font
        set.font = _.has(set, 'fontFile') ? fontFiles[set.fontFile] : fontFiles.default;
        // check if data is set locally
        if (!set.src) {
          _this.opt.onLoadProgress();
          if (!set.labels) {
            console.log('Warning: '+key+' does not have any valid label data');
            labelPromise.resolve();
            return;
          }
          var labelSet = new LabelSet(set);
          labelSet.load(labelPromise);
          labelSets[key] = labelSet;
          return;
        }
        // otherwise, make a request
        $.getJSON(set.src, function(values){
          _this.opt.onLoadProgress();
          var labelSet = new LabelSet(_.extend({}, set, {'values': values}));
          labelSet.load(labelPromise);
          labelSets[key] = labelSet;
        });
        labelPromises.push(labelPromise);
      });
      if (labelPromises.length < 1) labelPromises.resolve();
      else {
        $.when.apply(null, labelPromises).done(function() {
          console.log('Loaded labels');
          _this.labelSets = labelSets;
          deferred.resolve();
        });
      }
    });

    return deferred;
  };

  Collection.prototype.loadMenus = function(){
    var _this = this;

    if (_.has(this.opt.menus, 'viewOptions')) {
      _this.loadViewMenu(this.opt.menus.viewOptions);
    }
  };

  Collection.prototype.loadMetadata = function(){
    var _this = this;
    var deferred = $.Deferred();
    this.metadata = this.opt.metadata;
    setTimeout(function(){
      deferred.resolve()
    }, 1);
    return deferred;
  };

  Collection.prototype.loadOverlays = function(){
    var _this = this;
    var overlayPromises = [];
    var overlays = [];

    _.each(this.views, function(view, key){
      if (!_.has(view, 'overlays')) {
        _this.views[key].overlays = [];
        return;
      }
      var viewOverlays = [];
      _.each(view.overlays, function(options){
        var overlay = new Overlay(options);
        var deferred = overlay.load();
        viewOverlays.push(overlay);
        overlays.push(overlay);
        overlayPromises.push(deferred);
      });
      _this.views[key].overlays = viewOverlays;
    });

    this.overlays = overlays;
    var deferred = $.Deferred();
    if (overlayPromises.length < 1) deferred.resolve();
    else {
      $.when.apply(null, overlayPromises).done(function() {
        _this.opt.onLoadProgress();
        console.log('Loaded overlays');
        deferred.resolve();
      });
    }
    return deferred;
  };

  Collection.prototype.loadPositions = function(){
    var _this = this;
    var deferred = $.Deferred();
    var loaded = 0;
    var totalToLoad = _.keys(this.opt.positions).length;
    this.positions = {};

    _.each(this.opt.positions, function(set, key){
      // check if data is set locally
      if (!set.src) {
        loaded++;
        _this.opt.onLoadProgress();
        if (!set.values) console.log('Warning: '+key+' does not have any valid position data; will generate them randomly');
        _this.positions[key] = _.clone(set);
        if (loaded===totalToLoad) {
          console.log('Loaded all position data.');
          deferred.resolve();
        }
        return;
      }
      // otherwise, make a request
      $.getJSON(set.src, function(data){
        loaded++;
        _this.opt.onLoadProgress();
        _this.positions[key] = _.extend({}, set, {'values': data});
        if (loaded===totalToLoad) {
          console.log('Loaded all position data.');
          deferred.resolve();
        }
      });
    });
    return deferred;
  };

  Collection.prototype.loadSets = function(){
    var _this = this;
    var deferred = $.Deferred();
    var loaded = 0;
    var totalToLoad = _.keys(this.opt.sets).length;
    if (totalToLoad <= 0) deferred.resolve();
    _.each(this.opt.sets, function(set, key){
      // check if indice data is set locally
      if (!set.src) {
        loaded++;
        _this.opt.onLoadProgress();
        if (!set.indices) console.log('Warning: '+key+' does not have any valid set data');
        else _this.opt.sets[key] = {'values': set.indices};
        if (loaded===totalToLoad) {
          console.log('Loaded all set data.');
          deferred.resolve();
        }
        return;
      }
      // otherwise, make a request)
      $.getJSON(set.src, function(data){
        loaded++;
        _this.opt.onLoadProgress();
        _this.opt.sets[key] = {'values': data};
        if (loaded===totalToLoad) {
          console.log('Loaded all set data.');
          deferred.resolve();
        }
      });
    });
    return deferred;
  };

  Collection.prototype.loadSounds = function(){
    var _this = this;
    var deferreds = [];
    var soundSets = {};
    var views = this.views;

    _.each(this.opt.sounds, function(set, key){
      var deferred = $.Deferred();

      // pass in width/height/depth of default view
      if (_.has(set, 'defaultView') && _.has(views, set.defaultView)) {
        set = _.extend({}, set, _.pick(views[set.defaultView], 'width', 'height', 'depth'));
      }

      // check if data is set locally
      if (!set.src) {
        _this.opt.onLoadProgress();
        if (!set.sprites) {
          console.log('Warning: '+key+' does not have any valid sound data');
          deferred.resolve();
          return;
        }
        var soundSet = new SoundSet(_.extend(set, {'camera': _this.camera, 'listener': _this.listener}));
        soundSet.load(deferred);
        soundSets[key] = soundSet;
        return;
      }
      // otherwise, make a request
      $.getJSON(set.src, function(values){
        _this.opt.onLoadProgress();
        var soundSet = new SoundSet(_.extend({}, set, {'values': values, 'camera': _this.camera, 'listener': _this.listener}));
        soundSet.load(deferred);
        soundSets[key] = soundSet;
      });

      deferreds.push(deferred);
    });

    var deferred = $.Deferred();
    if (deferreds.length < 1) deferred.resolve();
    else {
      $.when.apply(null, deferreds).done(function() {
        console.log('Loaded sounds');
        _this.soundSets = soundSets;
        deferred.resolve();
      });
    }
    return deferred;
  };

  Collection.prototype.loadTextures = function(){
    var _this = this;
    var deferred = $.Deferred();
    var loaded = 0;
    var totalToLoad = _.reduce(this.opt.textures, function(memo, t){ return memo + t.assets.length; }, 0);
    this.textures = this.opt.textures;
    _.each(this.opt.textures, function(t, key){
      var assets = [];
      _.each(t.assets, function(asset, i){
        var textureLoader = new THREE.TextureLoader();
        var texture = textureLoader.load(asset.src, function() {
          loaded++;
          _this.opt.onLoadProgress();
          if (loaded===totalToLoad) {
            console.log('Loaded all texture assets.');
            deferred.resolve();
          }
        });
        assets.push({src: asset.src, texture: texture});
      });
      _this.textures[key].assets = assets;
    });
    deferred.resolve();
    return deferred;
  };

  Collection.prototype.loadViewMenu = function(options){
    var currentViewIndex = 0;

    _.each(options.radioItems, function(item, i){
      var id = 'view-'+item.value;
      $('#'+id).closest('label').addClass('active');
    });

    this.currentViewIndex = currentViewIndex;
    this.$viewOptions = $('.view-option');
  };

  Collection.prototype.onClickCanvas = function(pointer, npointer){
    var now = new Date().getTime();
    this.storyManager.update(now, npointer, this.camera);
    this.itemManager.update(now, npointer);

    // trigger a story to open
    var openedStoryKey = this.triggerStory();

    // triggered story; end here
    if (openedStoryKey !== false) return;

    // trigger an item if user did not click on story
    var previousItemIndex = this.itemManager.itemIndex;
    var triggeredItemIndex = this.triggerItem();

    // triggered item; end here
    if (triggeredItemIndex !== false) {
      // show previous item
      this.updateItemAlpha(previousItemIndex, 1, 10);
      return;
    }

    // deselect active item
    this.deselectActiveItem();
  };

  Collection.prototype.onClickKey = function($key, e){
    if (this.controls && this.controls.isFlying) return;
    var id = $key.attr('data-id');
    if (!_.has(this.keys, id)) return;

    var key = this.keys[id];
    var type = key.opt.type;
    var bounds = key.bounds;

    if ((type != "map" && type != "timeline") || !bounds) return;

    var p = Util.getRelativePoint($key, e.pageX, e.pageY);

    var originPosition = this.camera.position.clone();
    var targetPosition = originPosition.clone();

    if (type == "timeline") {
      targetPosition.z = MathUtil.lerp(bounds[2], bounds[3], p.x);
    } else if (type == "map") {
      targetPosition.x = MathUtil.lerp(bounds[1], bounds[0], p.x);
      targetPosition.z = MathUtil.lerp(bounds[3], bounds[2], p.y);
    }

    var distance = originPosition.distanceTo(targetPosition);
    var unitsPerSecond = 1000;
    var duration = parseInt(distance / unitsPerSecond * 1000);

    var targetLookAtPosition = false;
    this.controls.flyTo(targetPosition, targetLookAtPosition, duration);
  };

  Collection.prototype.onFinishedStart = function(){
    _.each(this.soundSets, function(soundSet, key){
      soundSet.active = true;
    });
  };

  Collection.prototype.onHoverOverKey = function($key, e){
    var id = $key.attr('data-id');
    if (!_.has(this.keys, id)) return;

    var p = Util.getRelativePoint($key, e.pageX, e.pageY);
    this.keys[id].onHover(p.x, p.y);
  };

  Collection.prototype.onReady = function(){
    var _this = this;
    var container = new THREE.Group();

    // default set is everything
    if (!_.has(this.opt.sets, 'default')) {
      this.opt.sets.default = {
        'values': _.range(_this.metadata.itemCount)
      };
    }

    globalRandomSeeder = new Math.seedrandom(this.opt.seedString);
    var currentView = this.views[this.currentViewKey];
    var sets = {};
    _.each(this.opt.sets, function(set, key){
      if (key !== 'default') return;
      var setPositions = _.extend({}, _.pick(currentView, 'width', 'height', 'depth'), _this.positions[currentView.layout]);
      var setTextures = _.has(_this.textures, key) ? _this.textures[key] : _this.textures.default;
      var set = new Set({
        'metadata': _this.metadata,
        'indices': set.values,
        'positions': setPositions,
        'textures': setTextures
      });
      sets[key] = set;
      container.add(set.getThree());
    });
    this.sets = sets;

    // create an invisible pointcloud for raycasting
    globalRandomSeeder = new Math.seedrandom(this.opt.seedString); // reset seed
    var pointCloud = new PointGeometry({
      'itemCount': _this.metadata.itemCount,
      'positions': _.extend({}, _.pick(currentView, 'width', 'height', 'depth'), _this.positions[currentView.layout]),
      'indices': _this.opt.sets.default.values.slice()
    });
    container.add(pointCloud.getThree());
    this.pointCloud = pointCloud;
    var raycaster = new Raycaster({
      'camera': this.camera,
      'points': pointCloud
    });
    this.itemManager.setRaycaster(raycaster);
    this.itemManager.updatePositions(pointCloud.positionArr, 0);
    this.storyManager.updatePositions(pointCloud.positionArr, 0);
    container.add(raycaster.getThree());

    _.each(this.labelSets, function(labelSet, key){
      container.add(labelSet.getThree());
    });

    _.each(this.overlays, function(overlay){
      container.add(overlay.getThree());
    });

    var hotspotGroup = new THREE.Group();
    this.storyManager.updateView(_this.currentViewKey);
    _.each(this.storyManager.stories, function(story, contentKey){
      hotspotGroup.add(story.hotspot.object);
    });
    container.add(hotspotGroup);

    this.container = container;
  };

  Collection.prototype.onViewOptionChange = function($input){
    if (this.isViewTransitioning) return false;
    var name = $input.attr('name');
    var value = $input.val();
    var index = parseInt($input.attr('data-index'));
    if (this.currentViewIndex===index) return false;

    this.currentViewIndex = index;

    // check if we're orbiting an item; exit then switch views
    if (this.controls.isOrbiting) {
      var onFinished = function(){
        $(document).trigger('view-changed', value);
      };
      // deselect item first
      $(document).trigger('deselect-item', [onFinished]);
      return true;
    }

    $(document).trigger('view-changed', value);
    return true;
  };

  Collection.prototype.resetFilters = function(transitionDuration){
    transitionDuration = transitionDuration || this.opt.ui.transitionDuration;
    this.updateAlpha(false, 1.0, transitionDuration);
  };

  Collection.prototype.setControls = function(controls){
    this.controls = controls;

    if (this.opt.guide) this.guide = new Guide({"steps": this.opt.guide, "inputMode": controls.device});
    else {
      $('.tour-start').css('display', 'none');
      $('.explore-start .text-label').text('Start');
    }
  };

  Collection.prototype.stepViewOption = function(step){
    if (!this.$viewOptions || !this.$viewOptions.length || this.isViewTransitioning) return;

    var currentViewIndex = this.currentViewIndex + step;
    if (currentViewIndex < 0) currentViewIndex = this.$viewOptions.length-1;
    else if (currentViewIndex >= this.$viewOptions.length) currentViewIndex = 0;

    this.$viewOptions.eq(currentViewIndex).prop('checked', true);
    this.$viewOptions.eq(currentViewIndex).focus();
    this.onViewOptionChange(this.$viewOptions.eq(currentViewIndex));
  };

  Collection.prototype.toggleMenus = function($button){
    $button.toggleClass('active');
    var isActive = $button.hasClass('active');

    var newText = isActive ? $button.attr('data-on') : $button.attr('data-off');
    var $parent = $button.parent();

    $button.text(newText);

    if (isActive) $parent.addClass('active');
    else $parent.removeClass('active');
  };

  Collection.prototype.triggerItem = function(itemIndex){
    var _this = this;

    var triggeredItemIndex = itemIndex !== undefined ? itemIndex : false;
    if (triggeredItemIndex===false) triggeredItemIndex = this.itemManager.triggerSelectedItem();
    else triggeredItemIndex = this.itemManager.triggerItem(triggeredItemIndex);

    if (triggeredItemIndex===false || triggeredItemIndex===undefined) return false;

    var position = this.itemManager.itemPositions[triggeredItemIndex];
    var anchorToPosition = true;
    this.controls.flyToOrbit(position, this.opt.zoomInDistance, this.opt.ui.zoomInTransitionDuration, anchorToPosition, function(){
      var finishedLoadingImage = _this.itemManager.onFlyFinished(triggeredItemIndex);
      $.when(finishedLoadingImage).done(function(){
        _this.updateItemAlpha(triggeredItemIndex, 0); // hide the current item
      });
    });

    return triggeredItemIndex;
  };

  Collection.prototype.triggerStory = function(forceClose){
    var _this = this;

    var resp = this.storyManager.triggerSelectedHotspot(forceClose);
    var openedStoryKey = resp.openedStoryKey;
    var closedStoryKey = resp.closedStoryKey;

    // apply filters accordingly
    var transitionDuration = Math.round(this.opt.ui.transitionDuration / 2);
    var view = this.views[this.currentViewKey];
    if (openedStoryKey !== false) {
      // apply filters
      this.filterBySet(openedStoryKey, transitionDuration);
      // hide hotspots
      _.each(this.stories, function(story, key){
        story.hideHotspot();
      });
      // adjust positions
      if (this.updatePositionTimeout) clearTimeout(this.updatePositionTimeout);
      this.updatePositionTimeout = setTimeout(function(){
        _this.updatePositions(view, transitionDuration, 4.0);
      }, transitionDuration);

      // close the guide if it's open
      this.guide && this.guide.close();

    } else if (closedStoryKey !== false) {
      // reset filters
      this.resetFilters(transitionDuration);
      // adjust positions
      this.updatePositions(view, transitionDuration, 1.0);
      // show hotspots
      this.storyManager.updateView(view.key)
    }

    if (this.storyManager.hasOpenStory()) {
      if (this.controls) this.controls.storyIsOpen = true;
      this.$el.addClass('story-is-open');
    } else {
      if (this.controls) this.controls.storyIsOpen = false;
      this.$el.removeClass('story-is-open');
    }

    return openedStoryKey;
  };

  Collection.prototype.triggerStoryById = function(storyId){
    this.storyManager.selectStory(storyId);
    this.triggerStory();
    this.jumpToStory(storyId);
  };

  Collection.prototype.update = function(now, pointerPosition){
    _.each(this.sets, function(set, key){
      set.update(now);
    });

    _.each(this.keys, function(key, keyValue){
      key.update(now);
    });

    _.each(this.labelSets, function(labelSet, key){
      labelSet.update(now);
    });

    _.each(this.overlays, function(overlay, key){
      overlay.update(now);
    });

    _.each(this.soundSets, function(soundSet){
      soundSet.update(now);
    });

    this.storyManager.update(now, pointerPosition, this.camera);
    this.itemManager.update(now, pointerPosition);

    if (this.isViewTransitioning && now >= this.transitionViewEnd) {
      this.isViewTransitioning = false;
    }
  };

  Collection.prototype.updateAlpha = function(fromAlpha, toAlpha, transitionDuration){
    transitionDuration = transitionDuration || this.opt.ui.transitionDuration;

    var _this = this;
    _.each(this.sets, function(set){
      set.updateAlpha(fromAlpha, toAlpha, transitionDuration);
    });

    this.pointCloud.updateAlpha(fromAlpha, toAlpha, transitionDuration)
  };

  Collection.prototype.updateItemAlpha = function(itemIndex, alpha, transitionDuration){
    if (itemIndex === false || itemIndex < 0) return;
    transitionDuration = transitionDuration===undefined ? this.opt.ui.transitionDuration : transitionDuration;
    var toAlphaValues = this.pointCloud.alphaArr;
    toAlphaValues[itemIndex] = alpha;
    this.updateAlpha(false, toAlphaValues, transitionDuration);
  };

  Collection.prototype.updatePositions = function(newView, transitionDuration, multiplier) {
    if (this.updatePositionTimeout) clearTimeout(this.updatePositionTimeout);
    var newPositions = this.positions[newView.layout];
    newPositions = _.extend({}, _.pick(newView, 'width', 'height', 'depth'), newPositions);
    // update layout
    globalRandomSeeder = new Math.seedrandom(this.opt.seedString);
    _.each(this.sets, function(set){
      set.updatePositions(newPositions, transitionDuration, multiplier);
    });
    // update point cloud for raycasting
    globalRandomSeeder = new Math.seedrandom(this.opt.seedString);
    var positionArr = this.pointCloud.updatePositions(newPositions, transitionDuration, multiplier);
    this.itemManager.hide(transitionDuration);

    // console.log(positionArr);

    // update stories/items
    this.storyManager.updatePositions(positionArr, transitionDuration);
    this.itemManager.updatePositions(positionArr, transitionDuration);
  };

  Collection.prototype.updateView = function(newValue, transitionDuration){
    if (newValue === this.currentViewKey) return;
    transitionDuration = transitionDuration || this.opt.ui.transitionDuration;

    var now = new Date().getTime();
    this.isViewTransitioning = true;
    this.transitionViewEnd = now + transitionDuration;

    if (this.changeViewComponentsTimeout) clearTimeout(this.changeViewComponentsTimeout);

    var _this = this;
    var newView = this.views[newValue];
    this.currentViewKey = newValue;

    this.updatePositions(newView, transitionDuration, 1.0);
    this.updateViewComponents(newView, this.opt.ui.componentTransitionDuration, true);

    // update components after finished changing positions to avoid overloading graphics
    this.changeViewComponentsTimeout = setTimeout(function(){
      _this.updateViewComponents(newView, _this.opt.ui.componentTransitionDuration, false);
    }, transitionDuration);

  };

  Collection.prototype.updateViewComponents = function(newView, transitionDuration, hide){
    // update keys
    var viewKeys = newView.keys ? newView.keys : [];
    _.each(this.keys, function(key, keyValue){
      if (hide && key.visible) {
        key.hide();
        return;
      } else if (hide) return;
      var valid = _.indexOf(viewKeys, keyValue) >= 0;
      if (valid && key.visible) return false;
      else if (valid) {
        key.setBounds(newView.bounds);
        key.show();
      } else key.hide();
    });

    // update labels
    var viewLabels = newView.labels ? newView.labels : [];
    _.each(this.labelSets, function(labelSet, key){
      if (hide && labelSet.visible) {
        labelSet.hide(transitionDuration);
        return;
      } else if (hide) return;
      var valid = _.indexOf(viewLabels, key) >= 0;
      if (valid && labelSet.visible) return false;
      else if (valid) labelSet.show(transitionDuration);
      else labelSet.hide(transitionDuration);
    });

    // update overlays
    _.each(this.views, function(view, key){
      if (key === newView.key) {
        _.each(view.overlays, function(overlay){
          if (!overlay.visible) overlay.show(transitionDuration);
        });
      } else {
        _.each(view.overlays, function(overlay){
          if (overlay.visible) overlay.hide(transitionDuration);
        });
      }
    });

    // update sounds
    var viewSounds = newView.sounds ? newView.sounds : [];
    _.each(this.soundSets, function(soundSet, key){
      if (hide && soundSet.active) {
        soundSet.active = false;
        return;
      } else if (hide) return;
      var valid = _.indexOf(viewSounds, key) >= 0;
      if (valid) soundSet.active = true;
      else soundSet.active = false;
    });

    // update stories
    this.storyManager.updateView(newView.key);

    // TODO: update menus

    // TODO: update controls
  };

  return Collection;

})();
