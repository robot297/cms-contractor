# customer-avatar Specification

## Purpose

Let a contractor put a face to a customer record. A contractor can capture a customer's photo with the device camera; the image is downscaled client-side and stored as a bounded-size data URL on the customer record, and is shown wherever the customer appears — with a neutral placeholder when there is no photo.

## Requirements

### Requirement: Capture a customer avatar with the camera

The system SHALL let a contractor capture a photo for one of their customers using the device camera and save it as that customer's avatar. The image SHALL be downscaled client-side and stored as a bounded-size data URL on the customer record. The system SHALL reject images that exceed the size limit or are not images.

#### Scenario: Capture and save an avatar

- **WHEN** a contractor captures a photo for a customer
- **THEN** the system stores the downscaled image as that customer's avatar

#### Scenario: Oversized image is rejected

- **WHEN** a submitted avatar exceeds the maximum stored size
- **THEN** the system rejects it and the customer's existing avatar is unchanged

### Requirement: Display the customer avatar

The system SHALL display a customer's avatar where the customer is shown (at least the customer directory). When a customer has no avatar, the system SHALL show a neutral placeholder.

#### Scenario: Avatar shows in the directory

- **WHEN** a customer with an avatar is listed in the directory
- **THEN** their photo is shown

#### Scenario: Placeholder when no avatar

- **WHEN** a customer without an avatar is listed
- **THEN** a neutral placeholder is shown instead of a photo
