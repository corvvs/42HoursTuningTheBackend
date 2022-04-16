alter table session add index session_value(value);
alter table record add index r_created_by(created_by);
alter table record add index r_status(status);
alter table record add index r_list_order2(updated_at desc, record_id asc);
alter table record add index r_tome(category_id, application_group);
alter table record_item_file add index rif_linked_record_id(linked_record_id);
alter table record_comment add index rc_linked_record_id(linked_record_id);
