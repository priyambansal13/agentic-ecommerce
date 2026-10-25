import { Module } from '@nestjs/common';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';
import { ObjectStore } from './object-store.js';

@Module({
  controllers: [ImagesController],
  providers: [ImagesService, ObjectStore],
  exports: [ImagesService, ObjectStore],
})
export class ImagesModule {}
