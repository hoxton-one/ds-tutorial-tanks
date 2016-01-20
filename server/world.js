var bulletRange = 30;
var bulletSpeed = 10;
var tankSpeed = 1;

function World( settings ) {
	this._settings = settings;
	this._ds = settings.deepstream;
	
	this._timeout = null;
	this._tanks = {};
	this._bullets = {};

	this._tanksList = this._ds.record.getList( settings.worldName + '/tanks' );	
	this._bulletsList = this._ds.record.getList( settings.worldName + '/bullets' );

	this._tanksList.setEntries( [] );
	this._bulletsList.setEntries( [] );

	this._ds.event.subscribe( 'create-tank', this._createTank.bind( this ) );
	this._ds.event.subscribe( 'fire', this._fireBullet.bind( this ) );

	this._updateState();
}

World.prototype._createTank = function( tankName ) {
	var tank = this._ds.record.getRecord( tankName );
	tank.set( {
		// Server Generated
		position: this._getInitialPosition(),
		color: this._getColor(),
		dimensions: { x: 75, y: 70 },
		turretRotation: 0,
		rotation: 0,
		destroyed: false,
		acceleration: 0,
		health: 3
	} );

	var tankControl = this._ds.record.getRecord( tankName + '-control' );
	tankControl.set( {
		//Client Generated
		direction: {
			left: false,
			right: false,
			forwards: false,
			backwards: false 
		},
		turretDirection: {
			left: false,
			right: false
		}
	} );

	tank.whenReady( function() {
		tankControl.whenReady( function() {
			if( this._tanksList.getEntries().indexOf( tankName ) === -1 ) {
				this._tanksList.addEntry( tankName );
			}
			this._tanks[ tankName ] = {
				view: tank,
				control: tankControl
			};
		}.bind( this ) );
	}.bind( this ) );
};

World.prototype._fireBullet = function( tankName ) {
	var tank = this._tanks[ tankName ].view;
	var bulletID = this._ds.getUid();
	var bullet = this._ds.record.getRecord( bulletID );

	bullet.set( {
		position: tank.get( 'position' ),
		dimensions: { 
			x: 12, 
			y: 26 
		},
		rotation: tank.get( 'turretRotation' ),
		rangeRemaining: bulletRange,
		owner: tankName
	} );

	bullet.whenReady( function() {
		this._bulletsList.addEntry( bulletID );
		this._bullets[ bulletID ] = bullet;
	}.bind( this ) );
};

World.prototype._updateState = function() {
	var tanks = this._tanks;
	var tank, direction;

	for( var tankName in tanks ) {
		tank = tanks[ tankName ];
		tankView = tank.view;
		tankControl = tank.control;

		direction = tankControl.get( 'direction' );
		turret = tankControl.get( 'turretDirection' );

		if( 
			( direction.left || direction.right ) && !( direction.left && direction.right ) 
			|| 
			( direction.forwards || direction.backwards ) && !( direction.forwards && direction.backwards ) 
		) {
			this._moveTank( direction, tank, tanks );
		}

		tankView.set( 'turretRotation', tankControl.get( 'turretRotation' ) );
	}

	// Update bullets
	var bullets = this._bullets;
	for( var bulletName in bullets ) {
		this._moveBullet( bullets[ bulletName ], tanks );
	}

	clearTimeout( this._timeout );
	this._timeout = setTimeout( this._updateState.bind( this ), 15 );
};

World.prototype._moveTank = function( direction, tank, tanks ) {
	var tankView = tank.view;
	var tankControl = tank.control;

	var rotation = tankView.get( 'rotation' );	

	if( direction.left ) {
		rotation -= ( Math.PI / 90 );		
	} else if( direction.right ) {
		rotation += ( Math.PI / 90 );
	}

	if( rotation > ( Math.PI * 2 ) ) {
		rotation = 0;
	} else if( rotation < 0 ) {
		rotation = Math.PI * 2;
	}

	var position = tankView.get( 'position' );	
	var dimensions = tankView.get( 'dimensions' );

	if( direction.forwards ) {
		position.x += ( Math.sin( rotation ) * tankSpeed );		
		position.y -= ( Math.cos( rotation ) * tankSpeed );		
	} else if( direction.backwards ) {
		position.x -= ( Math.sin( rotation ) * tankSpeed );		
		position.y += ( Math.cos( rotation ) * tankSpeed );		
	}

	// collision detection
	for( var tankName in tanks ) {
		if( tanks[ tankName ] === tank ) {
			continue;
		}
		if( this._intersects( position, tanks[ tankName ].view.get( 'position' ), dimensions, dimensions ) ) {
			return;
		}
	}

	tankView.set( 'rotation', rotation );
	tankView.set( 'position', position );
};

World.prototype._moveBullet = function( bullet, tanks ) {
	var position = bullet.get( 'position' );
	var bulletDimensions = bullet.get( 'dimensions' );
	var rangeRemaining = bullet.get( 'rangeRemaining');
	var rotation = bullet.get( 'rotation');

	var tankView;
	var tankHealth;
	for( var tankName in tanks ) {
		tankView = tanks[ tankName ].view;
		if( bullet.get( 'owner' ) === tankName ) {
			continue;
		}
		if( this._intersects( position, tankView.get( 'position' ), bulletDimensions, tankView.get( 'dimensions' ) ) ) {
			tankHealth =  tankView.get( 'health' ) - 1;
			tankView.set( 'health', tankHealth );
			if( tankHealth === 0 ) {
				tankView.set( 'destroyed', true );
				setTimeout( this._respawnTank.bind( this, tankName ), 2000 );
			}
			this._destroyBullet( bullet );
			return;
		}
	}

	if( rangeRemaining > 0 ) {
		position.x += ( Math.sin( rotation ) * bulletSpeed );		
		position.y -= ( Math.cos( rotation ) * bulletSpeed );		
		rangeRemaining--;

		bullet.set( 'position', position );
		bullet.set( 'rangeRemaining', rangeRemaining );

		return;
	} else {
		this._destroyBullet( bullet );
	}
};

World.prototype._destroyBullet = function( bullet ) {
	this._bulletsList.removeEntry( bullet.name );
	bullet.delete();
	delete this._bullets[ bullet.name ];
};

World.prototype._respawnTank = function( tankName ) {
	var tank = this._tanks[ tankName ];

	tank.view.set( {
		// Server Generated
		position: this._getInitialPosition(),
		color: tank.view.get( 'color' ), 
		dimensions: { x: 75, y: 70 },
		turretRotation: 0,
		rotation: 0,
		destroyed: false,
		health: 3
	} );

	tank.control.set( {
		//Client Generated
		direction: {
			left: false,
			right: false,
			forwards: false,
			backwards: false 
		},
		turretDirection: {
			left: false,
			right: false
		}
	} );
};

World.prototype._intersects = function( objectA, objectB, objectASize, objectBSize ) {
	var objectARight = objectA.x + objectASize.x;
	var objectABottom = objectA.y + objectASize.y;

	var objectBRight = objectB.x + objectBSize.x;
	var objectBBottom = objectB.y + objectBSize.y;

	if ( objectARight <= objectB.x )
	{
		return false;
	}

	if ( objectABottom <= objectB.y )
	{
		return false;
	}

	if ( objectA.x >= objectBRight )
	{
		return false;
	}

	if ( objectA.y >= objectBBottom )
	{
		return false;
	}

	return true;
};

World.prototype._getInitialPosition = function() {
	var x = 1000 *  Math.random() / 2;
	var y = 1000 *  Math.random() / 2;
	return { 
		x: x,
		y: y
	};
};

World.prototype._getColor = function() {
	return 1;
};

module.exports = World;